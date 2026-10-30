// Command catcher records the bodies of requests it receives, one per line, so the
// end-to-end test can check the webhook alerts Podux sends. Usage: catcher <addr> <file>
package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	f, _ := os.Create(os.Args[2])
	http.ListenAndServe(os.Args[1], http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		fmt.Fprintf(f, "%s\n", b)
		f.Sync()
		w.Write([]byte(`{"ok":true}`))
	}))
}
