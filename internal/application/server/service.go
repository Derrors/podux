package server

import (
	serverdomain "podux/internal/domain/server"

	"github.com/pocketbase/pocketbase/core"
)

type Service struct {
	app  core.App
	repo serverdomain.Repository
}

func NewService(app core.App, repo serverdomain.Repository) *Service {
	return &Service{app: app, repo: repo}
}

func (s *Service) GetServerCountByStatus(status serverdomain.ServerStatus) (int64, error) {
	return s.repo.CountByBootStatus(status)
}

func (s *Service) ResetAllServerStatus() {
	if err := s.repo.ResetAllBootStatus(); err != nil {
		s.app.Logger().Error("ResetAllServerStatus failed", "error", err)
	}
}
