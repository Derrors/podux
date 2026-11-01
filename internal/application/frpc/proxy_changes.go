package frpc

import (
	"reflect"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// ProxyNeedsReload ignores Podux's public-probe switch and its bookkeeping
// timestamp. Toggling that switch alone must not touch the running frpc.
func ProxyNeedsReload(record *core.Record) bool {
	before, after := record.Original().FieldsData(), record.FieldsData()
	for _, key := range []string{"probeDisabled", "updated"} {
		delete(before, key)
		delete(after, key)
	}
	return !reflect.DeepEqual(before, after)
}
