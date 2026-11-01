package backup

import (
	"archive/zip"
	"errors"
	"io"
	"io/fs"
	"strings"
)

var ErrInvalidArchive = errors.New("invalid backup archive: expected a safe ZIP containing data.db")

// Validate structure without extracting user-controlled archive paths. The PB
// restore still validates/extracts the whole archive before replacing any data.
func validateArchive(r io.ReaderAt, size int64) error {
	z, err := zip.NewReader(r, size)
	if err != nil {
		return ErrInvalidArchive
	}
	var database *zip.File
	seen := make(map[string]bool, len(z.File))
	for _, entry := range z.File {
		name := strings.TrimSuffix(entry.Name, "/")
		if !fs.ValidPath(name) || strings.ContainsAny(name, "\\:") || entry.Mode()&fs.ModeSymlink != 0 || seen[name] {
			return ErrInvalidArchive
		}
		seen[name] = true
		if name == "data.db" && !entry.FileInfo().IsDir() {
			database = entry
		}
	}
	if database == nil {
		return ErrInvalidArchive
	}
	f, err := database.Open()
	if err != nil {
		return ErrInvalidArchive
	}
	defer f.Close()
	var header [16]byte
	if _, err := io.ReadFull(f, header[:]); err != nil || string(header[:]) != "SQLite format 3\x00" {
		return ErrInvalidArchive
	}
	return nil
}
