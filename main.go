package main

import (
	"embed"
	"github.com/spf13/cobra"
	"io/fs"
	"log"

	"podux/internal/application/backup"
	"podux/internal/application/dashboard"
	"podux/internal/application/frpc"
	"podux/internal/application/importer"
	"podux/internal/application/monitoring"
	"podux/internal/application/notify"
	"podux/internal/application/proxy"
	"podux/internal/application/server"
	"podux/internal/application/system"
	"podux/internal/application/version"
	"podux/internal/infrastructure/persistence"
	httphandler "podux/internal/interfaces/http"
	_ "podux/migrations"

	"ganigeorgiev.com/pocketbase/pocketbase"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/plugins/migratecmd"
)

//go:embed all:pb_public
var pbPublicDir embed.FS

func main() {
	app := pocketbase.New()

	// enable auto creation of migration files when using the "migrate" command
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: true,
	})

	// Infrastructure (Repository implementations)
	serverRepo := persistence.NewServerRepository(app)
	proxyRepo := persistence.NewProxyRepository(app)
	visitorRepo := persistence.NewVisitorRepository(app)

	// Application Services
	serverService := server.NewService(app, serverRepo)
	proxyService := proxy.NewService(app, proxyRepo)
	frpcService := frpc.NewService(app, serverRepo, proxyRepo, visitorRepo)
	settingsService := system.NewService(app)
	geoService := monitoring.NewGeoService(app)
	metricsService := monitoring.NewMetricsService(app)
	frpsService := monitoring.NewFrpsService(app)
	probeService := monitoring.NewProbeService(app, frpsService)
	dashboardService := dashboard.NewService(app, serverService, proxyService, metricsService, frpsService)
	metricsScheduler := monitoring.NewMetricsScheduler(app, metricsService)
	networkMonitorService := monitoring.NewMonitorService(app, geoService, metricsService)
	importService := importer.NewService(app)
	notifyService := notify.NewService(app)
	frpcService.SetObserver(notifyService)
	networkMonitorService.SetLatencyObserver(notifyService.ObserveLatency)
	probeService.SetObserver(func(serverID, serverName string, results []monitoring.ProbeResult) {
		states := make([]notify.ProbeState, 0, len(results))
		for _, r := range results {
			states = append(states, notify.ProbeState{ID: r.ProxyID, Name: r.Name, Endpoint: r.Endpoint, Reachable: r.Reachable})
		}
		notifyService.ObserveProbes(serverID, serverName, states)
	})
	versionService := version.NewService(app)

	// HTTP Handlers
	frpcHandler := httphandler.NewFrpcHandler(app, frpcService)
	versionHandler := httphandler.NewVersionHandler(app, versionService)
	dashboardHandler := httphandler.NewDashboardHandler(dashboardService)
	systemHandler := httphandler.NewSystemHandler(app, settingsService)
	importHandler := httphandler.NewImportHandler(app, importService)
	serverHandler := httphandler.NewServerHandler(app, metricsService)
	notifyHandler := httphandler.NewNotifyHandler(notifyService)
	proxyHandler := httphandler.NewProxyHandler(app)
	backupHandler := httphandler.NewBackupHandler(app, backup.NewService(app))
	monitorHandler := httphandler.NewMonitorHandler(app, frpsService, probeService)

	// Hooks: reload the running frpc whenever one of its proxies or visitors changes.
	reloadServers := func(e *core.RecordEvent, serverIds ...string) {
		seen := map[string]bool{}
		for _, serverId := range serverIds {
			if serverId == "" || seen[serverId] || !frpcService.IsServerRunning(serverId) {
				continue
			}
			seen[serverId] = true
			app.Logger().Info("Config changed, reloading frpc", "collection", e.Record.Collection().Name, "recordId", e.Record.Id, "serverId", serverId)
			frpcService.RequestReload(serverId)
		}
	}
	app.OnRecordAfterCreateSuccess("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
		reloadServers(e, e.Record.GetString("serverId"))
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
		// A proxy moved to another server must also be removed from the old one.
		reloadServers(e, e.Record.GetString("serverId"), e.Record.Original().GetString("serverId"))
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
		reloadServers(e, e.Record.GetString("serverId"))
		return e.Next()
	})
	app.OnRecordAfterCreateSuccess("fh_visitors").BindFunc(func(e *core.RecordEvent) error {
		reloadServers(e, e.Record.GetString("serverId"))
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("fh_visitors").BindFunc(func(e *core.RecordEvent) error {
		reloadServers(e, e.Record.GetString("serverId"), e.Record.Original().GetString("serverId"))
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("fh_visitors").BindFunc(func(e *core.RecordEvent) error {
		reloadServers(e, e.Record.GetString("serverId"))
		return e.Next()
	})

	// A new or moved server gets its location now; a moved one drops the stale location first.
	app.OnRecordUpdate("fh_servers").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("serverAddr") != e.Record.Original().GetString("serverAddr") {
			e.Record.Set("geoLocation", nil)
		}
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("fh_servers").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("serverAddr") != e.Record.Original().GetString("serverAddr") {
			networkMonitorService.RefreshGeoLocation(e.Record.Id, e.Record.GetString("serverAddr"))
		}
		return e.Next()
	})
	app.OnRecordAfterCreateSuccess("fh_servers").BindFunc(func(e *core.RecordEvent) error {
		networkMonitorService.RefreshGeoLocation(e.Record.Id, e.Record.GetString("serverAddr"))
		return e.Next()
	})

	// Reject enabled proxies/visitors whose port or domain collides with another one.
	proxy.RegisterConflictChecks(app)
	// Disable temporary proxies once they expire.
	proxy.RegisterExpiry(app, notifyService.ProxiesExpired)

	// Deleting a server also deletes its proxies, visitors and metrics, then stops its frpc.
	server.RegisterDeleteHooks(app, func(serverId string) {
		if err := frpcService.TerminateFrpc(&serverId); err != nil {
			app.Logger().Error("Failed to stop frpc of deleted server", "error", err, "serverId", serverId)
		}
		metricsService.ForgetServer(serverId)
		notifyService.ForgetServer(serverId)
		frpsService.ForgetServer(serverId)
	})

	// Stop background work before the app shuts down (kcp/quic sessions close gracefully).
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		networkMonitorService.Stop()
		probeService.Stop()
		frpcService.StopAll()
		return e.Next()
	})

	// register custom routes
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		// Reset all server statuses to stopped on startup
		serverService.ResetAllServerStatus()
		// Reset all proxy statuses to offline on startup
		proxyService.ResetAllProxyBootStatus()

		// Auto-start servers with autoConnection enabled (non-blocking)
		go frpcService.AutoStartServers()

		// Start network monitoring service using intervals from settings
		latencyInterval, geoInterval := settingsService.GetMonitoringIntervals()
		networkMonitorService.Start(latencyInterval, geoInterval)
		settingsService.OnSettingsUpdated(func() {
			networkMonitorService.UpdateIntervals(settingsService.GetMonitoringIntervals())
		})
		metricsScheduler.Register()
		probeService.Start()

		// Register routes for each module
		frpcHandler.RegisterHandlers(e)
		versionHandler.RegisterHandlers(e)
		dashboardHandler.RegisterHandlers(e)
		systemHandler.RegisterHandlers(e)
		importHandler.RegisterHandlers(e)
		serverHandler.RegisterHandlers(e)
		notifyHandler.RegisterHandlers(e)
		proxyHandler.RegisterHandlers(e)
		backupHandler.RegisterHandlers(e)
		monitorHandler.RegisterHandlers(e)

		// Serve static files from embedded FS
		content, err := fs.Sub(pbPublicDir, "pb_public")
		if err != nil {
			return err
		}

		// Check if index.html exists to ensure frontend is properly embedded
		if _, err := content.Open("index.html"); err != nil {
			log.Printf("WARNING: index.html not found in embedded assets! Frontend may not load. Error: %v", err)
		}

		e.Router.GET("/{path...}", apis.Static(content, true))

		return e.Next()
	})

	// Overwrite the default serve command to suppress the default startup banner
	// and use our custom logs
	for _, cmd := range app.RootCmd.Commands() {
		if cmd.Use == "serve" {
			cmd.Run = nil
			cmd.RunE = func(cmd *cobra.Command, args []string) error {
				domains := args

				httpAddr, _ := cmd.Flags().GetString("http")
				httpsAddr, _ := cmd.Flags().GetString("https")
				origins, _ := cmd.Flags().GetStringSlice("origins")

				// replicate default logic from pocketbase
				if httpAddr == "" {
					if len(domains) > 0 {
						httpAddr = "0.0.0.0:80"
					} else {
						httpAddr = "127.0.0.1:8090"
					}
				}

				if httpsAddr == "" {
					if len(domains) > 0 {
						httpsAddr = "0.0.0.0:443"
					}
				}

				log.Println("Starting PocketBase server...")
				log.Println("----------------------------------------------------------------")
				log.Println("Frontend: http://" + httpAddr + "/")
				log.Println("Admin UI: http://" + httpAddr + "/_/")
				log.Println("----------------------------------------------------------------")

				return apis.Serve(app, apis.ServeConfig{
					HttpAddr:           httpAddr,
					HttpsAddr:          httpsAddr,
					ShowStartBanner:    false,
					AllowedOrigins:     origins,
					CertificateDomains: domains,
				})
			}
			break
		}
	}

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
