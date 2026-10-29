package server

// Repository defines persistence operations for the server domain.
type Repository interface {
	CountByBootStatus(status ServerStatus) (int64, error)
	UpdateBootStatus(id string, status ServerStatus) error
	ResetAllBootStatus() error
	FindAllWithAutoConnect() ([]ServerRecord, error)
}
