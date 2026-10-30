package persistence

import (
	"podux/internal/domain/visitor"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

type VisitorRepository struct {
	app core.App
}

func NewVisitorRepository(app core.App) *VisitorRepository {
	return &VisitorRepository{app: app}
}

func (r *VisitorRepository) FindEnabledByServerID(serverID string) ([]visitor.Visitor, error) {
	var visitors []visitor.Visitor
	err := r.app.DB().
		Select("fh_visitors.*").
		From("fh_visitors").
		Where(dbx.HashExp{"serverId": serverID, "status": visitor.StatusEnabled}).
		All(&visitors)
	if err != nil {
		r.app.Logger().Error("Failed to find enabled visitors by server id", "serverID", serverID, "error", err)
		return nil, err
	}
	return visitors, nil
}
