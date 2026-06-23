package raft

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

type NodeState int

const (
	Follower NodeState = iota
	Candidate
	Leader
)

type LogEntry struct {
	Term    int
	Index   int
	Command string
	Data    string
}

type AppendEntriesRequest struct {
	Term         int
	LeaderID     string
	PrevLogIndex int
	PrevLogTerm  int
	Entries      []LogEntry
	LeaderCommit int
}

type AppendEntriesResponse struct {
	Term    int
	Success bool
}

type RequestVoteRequest struct {
	Term         int
	CandidateID  string
	LastLogIndex int
	LastLogTerm  int
}

type RequestVoteResponse struct {
	Term        int
	VoteGranted bool
}

type RaftNode struct {
	mu sync.Mutex

	id          string
	state       NodeState
	currentTerm int
	votedFor    string
	log         []LogEntry
	commitIndex int
	lastApplied int

	// Leader state
	nextIndex  map[string]int
	matchIndex map[string]int

	peers        []string
	electionTimer *time.Timer
	heartbeatInterval time.Duration

	applyCh chan LogEntry
}

func NewRaftNode(id string, peers []string) *RaftNode {
	node := &RaftNode{
		id:                id,
		state:             Follower,
		currentTerm:       0,
		votedFor:          "",
		log:               make([]LogEntry, 0),
		commitIndex:       -1,
		lastApplied:       -1,
		nextIndex:         make(map[string]int),
		matchIndex:        make(map[string]int),
		peers:             peers,
		heartbeatInterval: 150 * time.Millisecond,
		applyCh:           make(chan LogEntry, 100),
	}
	return node
}

func (n *RaftNode) GetState() (int, NodeState) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.currentTerm, n.state
}

func (n *RaftNode) GetID() string {
	return n.id
}

func (n *RaftNode) GetLog() []LogEntry {
	n.mu.Lock()
	defer n.mu.Unlock()
	result := make([]LogEntry, len(n.log))
	copy(result, n.log)
	return result
}

func (n *RaftNode) GetCommitIndex() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.commitIndex
}

// BUG 1: Election logic is wrong - doesn't properly check log up-to-date
func (n *RaftNode) HandleRequestVote(req RequestVoteRequest) RequestVoteResponse {
	n.mu.Lock()
	defer n.mu.Unlock()

	resp := RequestVoteResponse{Term: n.currentTerm, VoteGranted: false}

	if req.Term < n.currentTerm {
		return resp
	}

	if req.Term > n.currentTerm {
		n.currentTerm = req.Term
		n.state = Follower
		n.votedFor = ""
	}

	// BUG: Should check if candidate's log is at least as up-to-date
	// Missing the log comparison check
	if n.votedFor == "" || n.votedFor == req.CandidateID {
		n.votedFor = req.CandidateID
		resp.VoteGranted = true
		resp.Term = n.currentTerm
	}

	return resp
}

// BUG 2: AppendEntries doesn't properly verify prev log entry
func (n *RaftNode) HandleAppendEntries(req AppendEntriesRequest) AppendEntriesResponse {
	n.mu.Lock()
	defer n.mu.Unlock()

	resp := AppendEntriesResponse{Term: n.currentTerm, Success: false}

	if req.Term < n.currentTerm {
		return resp
	}

	if req.Term > n.currentTerm {
		n.currentTerm = req.Term
		n.state = Follower
		n.votedFor = ""
	}

	// BUG: Should verify that prevLogIndex and prevLogTerm match
	// Currently skips this check entirely, accepting all entries
	if req.PrevLogIndex >= 0 {
		// BUG: Off-by-one - should check len(n.log) > req.PrevLogIndex
		if len(n.log) < req.PrevLogIndex {
			return resp
		}
		// BUG: Missing term comparison at PrevLogIndex
	}

	// Append new entries
	for _, entry := range req.Entries {
		if entry.Index < len(n.log) {
			// BUG 3: Doesn't check for conflicting entries (different terms)
			// Should compare terms and truncate if mismatch
			continue
		}
		n.log = append(n.log, entry)
	}

	// Update commit index
	if req.LeaderCommit > n.commitIndex {
		lastNewIndex := len(n.log) - 1
		if req.LeaderCommit < lastNewIndex {
			n.commitIndex = req.LeaderCommit
		} else {
			n.commitIndex = lastNewIndex
		}
	}

	resp.Success = true
	return resp
}

// BUG 4: StartElection doesn't properly count votes
func (n *RaftNode) StartElection(voteResponses []RequestVoteResponse) bool {
	n.mu.Lock()
	defer n.mu.Unlock()

	n.currentTerm++
	n.state = Candidate
	n.votedFor = n.id

	votesReceived := 0 // BUG: Should start at 1 (self-vote)

	for _, resp := range voteResponses {
		if resp.Term > n.currentTerm {
			n.currentTerm = resp.Term
			n.state = Follower
			n.votedFor = ""
			return false
		}
		if resp.VoteGranted {
			votesReceived++
		}
	}

	// BUG: majority calculation is wrong - should be (len(peers)+1)/2 + 1
	// Currently uses len(peers)/2 which is too low
	majority := len(n.peers) / 2
	if votesReceived >= majority {
		n.state = Leader
		// Initialize leader state
		for _, peer := range n.peers {
			n.nextIndex[peer] = len(n.log)
			n.matchIndex[peer] = -1
		}
		return true
	}

	n.state = Follower
	return false
}

func (n *RaftNode) ProposeEntry(command, data string) (LogEntry, error) {
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.state != Leader {
		return LogEntry{}, fmt.Errorf("not the leader")
	}

	entry := LogEntry{
		Term:    n.currentTerm,
		Index:   len(n.log),
		Command: command,
		Data:    data,
	}
	n.log = append(n.log, entry)
	return entry, nil
}

// BUG 5: UpdateCommitIndex doesn't properly find the median match index
func (n *RaftNode) UpdateCommitIndex() {
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.state != Leader {
		return
	}

	for i := len(n.log) - 1; i > n.commitIndex; i-- {
		if n.log[i].Term != n.currentTerm {
			continue
		}

		replicatedCount := 1 // self
		for _, peer := range n.peers {
			if n.matchIndex[peer] >= i {
				replicatedCount++
			}
		}

		// BUG: Wrong majority check - same as election bug
		if replicatedCount > len(n.peers)/2 {
			n.commitIndex = i
			break
		}
	}
}

func (n *RaftNode) ResetElectionTimer() {
	timeout := time.Duration(150+rand.Intn(150)) * time.Millisecond
	if n.electionTimer != nil {
		n.electionTimer.Reset(timeout)
	} else {
		n.electionTimer = time.NewTimer(timeout)
	}
}
