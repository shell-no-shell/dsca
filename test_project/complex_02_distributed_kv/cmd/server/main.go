package main

import (
	"fmt"
	"os"

	"github.com/dsca-test/distributed-kv/internal/store"
	"github.com/dsca-test/distributed-kv/internal/transport"
)

func main() {
	// BUG: No flag parsing - hard-coded values
	addr := "localhost:9000"
	if len(os.Args) > 1 {
		addr = os.Args[1]
	}

	kv := store.NewKVStore()

	handler := func(req transport.Request) transport.Response {
		switch req.Type {
		case transport.MsgGet:
			val, ver, err := kv.Get(req.Key)
			if err != nil {
				return transport.Response{Success: false, Error: err.Error()}
			}
			return transport.Response{Success: true, Value: val, Version: ver}

		case transport.MsgSet:
			ver, err := kv.Set(req.Key, req.Value)
			if err != nil {
				return transport.Response{Success: false, Error: err.Error()}
			}
			return transport.Response{Success: true, Version: ver}

		case transport.MsgDelete:
			err := kv.Delete(req.Key)
			if err != nil {
				return transport.Response{Success: false, Error: err.Error()}
			}
			return transport.Response{Success: true}

		default:
			return transport.Response{Success: false, Error: "unknown message type"}
		}
	}

	server := transport.NewServer(addr, handler)
	if err := server.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("KV store listening on %s\n", addr)

	// Block forever (simplified - no signal handling)
	select {}
}
