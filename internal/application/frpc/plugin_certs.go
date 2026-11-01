package frpc

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	v1 "github.com/fatedier/frp/pkg/config/v1"
)

func pluginCertFields(cfg v1.ProxyConfigurer) (crt, key *string) {
	switch o := cfg.GetBaseConfig().Plugin.ClientPluginOptions.(type) {
	case *v1.HTTPS2HTTPPluginOptions:
		return &o.CrtPath, &o.KeyPath
	case *v1.HTTPS2HTTPSPluginOptions:
		return &o.CrtPath, &o.KeyPath
	case *v1.TLS2RawPluginOptions:
		return &o.CrtPath, &o.KeyPath
	}
	return nil, nil
}

func isPEM(s string) bool { return strings.Contains(s, "-----BEGIN") }

// certRoot confines every operation to the trusted data directory. Reject symlink
// directory components, even when they point somewhere else inside that directory.
// os.Root also prevents a concurrent symlink replacement escaping the boundary.
func (fs *Service) certRoot(serverID, subdir string) (*os.Root, string, error) {
	if !validServerID.MatchString(serverID) {
		return nil, "", fmt.Errorf("invalid server id")
	}
	root, err := os.OpenRoot(fs.app.DataDir())
	if err != nil {
		return nil, "", err
	}
	for _, part := range []string{"frpc", serverID, subdir} {
		err := root.Mkdir(part, 0o700)
		if err != nil && !os.IsExist(err) {
			root.Close()
			return nil, "", err
		}
		info, err := root.Lstat(part)
		if err != nil {
			root.Close()
			return nil, "", err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			root.Close()
			return nil, "", fmt.Errorf("unsafe certificate directory")
		}
		next, err := root.OpenRoot(part)
		root.Close()
		if err != nil {
			return nil, "", err
		}
		root = next
	}
	return root, filepath.Join(fs.app.DataDir(), "frpc", serverID, subdir), nil
}

// atomicCertWrite never follows an existing destination symlink and never exposes
// a partially written key. All managed certificate files are owner-only.
func atomicCertWrite(root *os.Root, name, contents string) error {
	if filepath.Base(name) != name || name == "." {
		return fmt.Errorf("invalid certificate filename")
	}
	tmp := fmt.Sprintf(".tmp-%x", rand.Text())
	f, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer root.Remove(tmp)
	if _, err = io.WriteString(f, contents); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return root.Rename(tmp, name)
}

// Resolve the ID against storage: editable runtime names are never filesystem names.
func (fs *Service) proxyCertID(serverID string, cfg v1.ProxyConfigurer) (string, error) {
	name := cfg.GetBaseConfig().Name
	if len(name) < 16 {
		return "", fmt.Errorf("invalid proxy identity")
	}
	id := name[len(name)-15:]
	if !validServerID.MatchString(id) {
		return "", fmt.Errorf("invalid proxy identity")
	}
	r, err := fs.app.FindRecordById("fh_proxies", id)
	if err != nil {
		return "", err
	}
	if r.GetString("serverId") != serverID || r.GetString("name")+"-"+r.Id != name {
		return "", fmt.Errorf("proxy identity changed")
	}
	return r.Id, nil
}

func (fs *Service) writePluginCerts(serverID string, cfgs []v1.ProxyConfigurer) error {
	var root *os.Root
	var dir string
	defer func() {
		if root != nil {
			root.Close()
		}
	}()
	for _, cfg := range cfgs {
		crt, key := pluginCertFields(cfg)
		if crt == nil || (!isPEM(*crt) && !isPEM(*key)) {
			continue
		}
		id, err := fs.proxyCertID(serverID, cfg)
		if err != nil {
			return err
		}
		if root == nil {
			root, dir, err = fs.certRoot(serverID, "plugin-certs")
			if err != nil {
				return err
			}
		}
		for _, f := range []struct {
			value *string
			ext   string
		}{{crt, ".crt"}, {key, ".key"}} {
			if !isPEM(*f.value) {
				continue
			}
			sum := sha256.Sum256([]byte(*f.value))
			name := fmt.Sprintf("%s-%x%s", id, sum[:16], f.ext)
			if err := atomicCertWrite(root, name, *f.value); err != nil {
				return err
			}
			*f.value = filepath.Join(dir, name)
		}
	}
	return nil
}

var managedCertName = regexp.MustCompile(`^[a-z0-9]{15}-[a-f0-9]{32}\.(crt|key)$`)

func pluginFiles(cfgs []v1.ProxyConfigurer) map[string]bool {
	files := map[string]bool{}
	for _, cfg := range cfgs {
		crt, key := pluginCertFields(cfg)
		if crt == nil {
			continue
		}
		for _, path := range []string{*crt, *key} {
			if managedCertName.MatchString(filepath.Base(path)) {
				files[filepath.Base(path)] = true
			}
		}
	}
	return files
}

// Retain the applied generation and its predecessor while asynchronous frp plugin
// restarts finish opening their files. Run only after a successful config update;
// failed reloads must not delete the still-active generation.
func (fs *Service) prunePluginCerts(serverID string, current, previous map[string]bool) error {
	root, _, err := fs.certRoot(serverID, "plugin-certs")
	if err != nil {
		return err
	}
	defer root.Close()
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	entries, err := dir.ReadDir(-1)
	dir.Close()
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() && managedCertName.MatchString(name) && !current[name] && !previous[name] {
			if err := root.Remove(name); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return nil
}

func (fs *Service) exportPluginCerts(serverID string, cfgs []v1.ProxyConfigurer) ([]string, error) {
	var files []string
	for _, cfg := range cfgs {
		crt, key := pluginCertFields(cfg)
		if crt == nil || (!isPEM(*crt) && !isPEM(*key)) {
			continue
		}
		id, err := fs.proxyCertID(serverID, cfg)
		if err != nil {
			return nil, err
		}
		for _, f := range []struct {
			value *string
			ext   string
		}{{crt, ".crt"}, {key, ".key"}} {
			if isPEM(*f.value) {
				*f.value = "certs/" + id + f.ext
				files = append(files, *f.value)
			}
		}
	}
	return files, nil
}

func (fs *Service) materializeCommon(serverID string, cfg *v1.ClientCommonConfig) error {
	cfg.Log.To = sharedLogPath(fs.app.DataDir())
	var root *os.Root
	var dir string
	defer func() {
		if root != nil {
			root.Close()
		}
	}()
	for _, f := range []struct {
		value *string
		name  string
	}{
		{&cfg.Transport.TLS.CertFile, "cert.pem"}, {&cfg.Transport.TLS.KeyFile, "key.pem"},
		{&cfg.Transport.TLS.TrustedCaFile, "ca.pem"}, {&cfg.Auth.OIDC.TrustedCaFile, "oidc-ca.pem"},
	} {
		if *f.value == "" {
			continue
		}
		if root == nil {
			var err error
			root, dir, err = fs.certRoot(serverID, "certs")
			if err != nil {
				return err
			}
		}
		if err := atomicCertWrite(root, f.name, *f.value); err != nil {
			return err
		}
		*f.value = filepath.Join(dir, f.name)
	}
	return nil
}
