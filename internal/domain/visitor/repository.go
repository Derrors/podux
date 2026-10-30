package visitor

// Repository defines persistence operations for the visitor domain.
type Repository interface {
	FindEnabledByServerID(serverID string) ([]Visitor, error)
}
