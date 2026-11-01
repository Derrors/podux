package monitoring

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// RegisterProxyHooks must be called once before Start. The optional forget
// callback clears only this proxy's public-probe alert state, not frpc alerts.
func (s *ProbeService) RegisterProxyHooks(forget func(proxyID string)) {
	invalidate := func(id string) {
		s.observeMu.Lock()
		defer s.observeMu.Unlock()
		s.mu.Lock()
		s.invalidated[id] = true
		delete(s.results, id)
		if cancel := s.active[id]; cancel != nil {
			cancel()
		}
		s.mu.Unlock()
		if forget != nil {
			forget(id)
		}
	}
	s.app.OnRecordAfterUpdateSuccess("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
		before := e.Record.Original()
		if e.Record.GetBool("probeDisabled") != before.GetBool("probeDisabled") ||
			e.Record.GetString("serverId") != before.GetString("serverId") ||
			e.Record.GetString("status") != before.GetString("status") {
			invalidate(e.Record.Id)
		}
		return e.Next()
	})
	s.app.OnRecordAfterDeleteSuccess("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
		invalidate(e.Record.Id)
		return e.Next()
	})
}
