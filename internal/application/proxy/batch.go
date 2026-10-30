package proxy

import (
	"errors"
	"fmt"

	proxydomain "podux/internal/domain/proxy"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Batch actions on proxies.
const (
	BatchEnable  = "enable"
	BatchDisable = "disable"
	BatchDelete  = "delete"
	BatchMove    = "move"
)

// BatchError names the proxy a batch stopped at; Err may hold field validation errors.
type BatchError struct {
	ProxyName string
	Err       error
}

func (e *BatchError) Error() string { return fmt.Sprintf("proxy %q: %v", e.ProxyName, e.Err) }
func (e *BatchError) Unwrap() error { return e.Err }

// ErrInvalidBatch is returned for an unknown action, no IDs or a missing target server.
var ErrInvalidBatch = errors.New("invalid batch request")

// Batch enables, disables, deletes or moves (to serverID) the given proxies in one
// transaction: if any of them fails, e.g. on a port conflict, none is changed.
// Record hooks still fire per proxy; their frpc reloads are merged per server.
func Batch(app core.App, ids []string, action, serverID string) (int, error) {
	if len(ids) == 0 {
		return 0, ErrInvalidBatch
	}
	switch action {
	case BatchEnable, BatchDisable, BatchDelete:
	case BatchMove:
		if serverID == "" {
			return 0, ErrInvalidBatch
		}
		if _, err := app.FindRecordById("fh_servers", serverID); err != nil {
			return 0, fmt.Errorf("%w: server not found", ErrInvalidBatch)
		}
	default:
		return 0, ErrInvalidBatch
	}

	err := app.RunInTransaction(func(tx core.App) error {
		records, err := tx.FindRecordsByIds("fh_proxies", ids)
		if err != nil {
			return err
		}
		if len(records) != len(ids) {
			return fmt.Errorf("%w: some proxies were not found", ErrInvalidBatch)
		}
		for _, r := range records {
			switch action {
			case BatchDelete:
				err = tx.Delete(r)
			case BatchEnable:
				r.Set("status", string(proxydomain.ProxyStatusEnabled))
				err = tx.Save(r)
			case BatchDisable:
				r.Set("status", string(proxydomain.ProxyStatusDisabled))
				err = tx.Save(r)
			case BatchMove:
				r.Set("serverId", serverID)
				err = tx.Save(r)
			}
			if err != nil {
				return &BatchError{ProxyName: r.GetString("name"), Err: err}
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return len(ids), nil
}
