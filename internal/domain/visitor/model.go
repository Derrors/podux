package visitor

import "podux/pkg/types"

// Visitor is a frpc visitor: a local listener that reaches an stcp/sudp/xtcp
// proxy (often on another machine) through the frps of its server.
type Visitor struct {
	Id             string        `db:"id" json:"id"`
	ServerId       string        `db:"serverId" json:"serverId"`
	VisitorType    string        `db:"visitorType" json:"visitorType"`
	Name           string        `db:"name" json:"name"`
	ServerName     string        `db:"serverName" json:"serverName"`
	ServerUser     string        `db:"serverUser" json:"serverUser,omitempty"`
	SecretKey      string        `db:"secretKey" json:"secretKey,omitempty"`
	BindAddr       string        `db:"bindAddr" json:"bindAddr,omitempty"`
	BindPort       int           `db:"bindPort" json:"bindPort"`
	KeepTunnelOpen bool          `db:"keepTunnelOpen" json:"keepTunnelOpen,omitempty"`
	Transport      types.JSONMap `db:"transport" json:"transport,omitempty"`
	Description    string        `db:"description" json:"description"`
	Status         string        `db:"status" json:"status"`
}

// StatusEnabled marks a visitor that frpc should run.
const StatusEnabled = "enabled"
