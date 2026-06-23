package transport

import (
	"fmt"
	"sync"
)

type MessageType int

const (
	MsgGet MessageType = iota
	MsgSet
	MsgDelete
	MsgCAS
)

type Request struct {
	Type     MessageType
	Key      string
	Value    string
	Version  int64
}

type Response struct {
	Success bool
	Value   string
	Version int64
	Error   string
}

type MessageHandler func(req Request) Response

type Server struct {
	mu       sync.Mutex
	addr     string
	handler  MessageHandler
	running  bool
	// BUG: No connection tracking - connections leak
	connCount int
}

func NewServer(addr string, handler MessageHandler) *Server {
	return &Server{
		addr:    addr,
		handler: handler,
	}
}

func (s *Server) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return fmt.Errorf("server already running")
	}
	s.running = true
	return nil
}

func (s *Server) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return fmt.Errorf("server not running")
	}
	s.running = false
	return nil
}

func (s *Server) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

func (s *Server) HandleRequest(req Request) Response {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return Response{Success: false, Error: "server not running"}
	}
	s.connCount++
	s.mu.Unlock()

	if s.handler == nil {
		return Response{Success: false, Error: "no handler registered"}
	}

	return s.handler(req)
	// BUG: connCount never decremented - connection leak tracking
}

func (s *Server) GetConnectionCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.connCount
}

type Client struct {
	target string
	server *Server // In-process for testing
}

func NewClient(target string, server *Server) *Client {
	return &Client{
		target: target,
		server: server,
	}
}

func (c *Client) Send(req Request) (Response, error) {
	if c.server == nil {
		return Response{}, fmt.Errorf("not connected to server")
	}
	resp := c.server.HandleRequest(req)
	return resp, nil
}

func (c *Client) Get(key string) (string, int64, error) {
	resp, err := c.Send(Request{Type: MsgGet, Key: key})
	if err != nil {
		return "", 0, err
	}
	if !resp.Success {
		return "", 0, fmt.Errorf(resp.Error)
	}
	return resp.Value, resp.Version, nil
}

func (c *Client) Set(key, value string) (int64, error) {
	resp, err := c.Send(Request{Type: MsgSet, Key: key, Value: value})
	if err != nil {
		return 0, err
	}
	if !resp.Success {
		return 0, fmt.Errorf(resp.Error)
	}
	return resp.Version, nil
}
