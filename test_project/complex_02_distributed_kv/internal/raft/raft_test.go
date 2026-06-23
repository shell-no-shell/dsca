package raft

import (
	"testing"
)

func TestNewRaftNode(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})

	term, state := node.GetState()
	if term != 0 {
		t.Errorf("expected initial term 0, got %d", term)
	}
	if state != Follower {
		t.Errorf("expected initial state Follower, got %d", state)
	}
	if node.GetID() != "node1" {
		t.Errorf("expected id node1, got %s", node.GetID())
	}
}

func TestRequestVoteBasic(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})

	resp := node.HandleRequestVote(RequestVoteRequest{
		Term:         1,
		CandidateID:  "node2",
		LastLogIndex: -1,
		LastLogTerm:  0,
	})

	if !resp.VoteGranted {
		t.Error("expected vote to be granted")
	}
	if resp.Term != 1 {
		t.Errorf("expected term 1, got %d", resp.Term)
	}
}

func TestRequestVoteStaleTerm(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})
	// Advance term
	node.HandleRequestVote(RequestVoteRequest{Term: 5, CandidateID: "node2"})

	resp := node.HandleRequestVote(RequestVoteRequest{
		Term:        3, // stale
		CandidateID: "node3",
	})

	if resp.VoteGranted {
		t.Error("should not grant vote for stale term")
	}
}

func TestRequestVoteAlreadyVoted(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})

	// Vote for node2
	node.HandleRequestVote(RequestVoteRequest{Term: 1, CandidateID: "node2"})

	// node3 asks for vote in same term
	resp := node.HandleRequestVote(RequestVoteRequest{Term: 1, CandidateID: "node3"})

	if resp.VoteGranted {
		t.Error("should not grant vote to node3 when already voted for node2")
	}
}

func TestRequestVoteLogUpToDate(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})

	// Add some entries to node1's log
	node.mu.Lock()
	node.log = append(node.log, LogEntry{Term: 2, Index: 0, Command: "set", Data: "x=1"})
	node.log = append(node.log, LogEntry{Term: 3, Index: 1, Command: "set", Data: "y=2"})
	node.currentTerm = 3
	node.mu.Unlock()

	// Candidate with shorter/older log should NOT get the vote
	resp := node.HandleRequestVote(RequestVoteRequest{
		Term:         4,
		CandidateID:  "node2",
		LastLogIndex: 0,  // shorter log
		LastLogTerm:  1,  // older term
	})

	// BUG TEST: This SHOULD deny the vote (candidate's log is not up-to-date)
	// but the current implementation doesn't check log freshness
	if resp.VoteGranted {
		t.Error("should NOT grant vote to candidate with older log")
	}
}

func TestAppendEntriesHeartbeat(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})

	resp := node.HandleAppendEntries(AppendEntriesRequest{
		Term:         1,
		LeaderID:     "node2",
		PrevLogIndex: -1,
		PrevLogTerm:  0,
		Entries:      nil,
		LeaderCommit: -1,
	})

	if !resp.Success {
		t.Error("heartbeat should succeed")
	}
}

func TestAppendEntriesStaleTerm(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})
	node.mu.Lock()
	node.currentTerm = 5
	node.mu.Unlock()

	resp := node.HandleAppendEntries(AppendEntriesRequest{
		Term:     3,
		LeaderID: "node2",
	})

	if resp.Success {
		t.Error("should reject append with stale term")
	}
}

func TestAppendEntriesPrevLogCheck(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})

	// Node has entry at index 0 with term 1
	node.mu.Lock()
	node.log = append(node.log, LogEntry{Term: 1, Index: 0, Command: "set", Data: "x=1"})
	node.mu.Unlock()

	// Leader claims prev entry at index 0 has term 2 (wrong!)
	resp := node.HandleAppendEntries(AppendEntriesRequest{
		Term:         2,
		LeaderID:     "node2",
		PrevLogIndex: 0,
		PrevLogTerm:  2, // wrong term - doesn't match our entry
		Entries:      []LogEntry{{Term: 2, Index: 1, Command: "set", Data: "y=2"}},
		LeaderCommit: -1,
	})

	// BUG TEST: Should reject because prev log term doesn't match
	if resp.Success {
		t.Error("should reject when prev log term doesn't match")
	}
}

func TestAppendEntriesConflictResolution(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})

	// Node has entries from a previous leader
	node.mu.Lock()
	node.log = append(node.log,
		LogEntry{Term: 1, Index: 0, Command: "set", Data: "x=1"},
		LogEntry{Term: 1, Index: 1, Command: "set", Data: "y=2"},
		LogEntry{Term: 2, Index: 2, Command: "set", Data: "z=3"}, // from old leader
	)
	node.mu.Unlock()

	// New leader sends entries that conflict at index 2
	resp := node.HandleAppendEntries(AppendEntriesRequest{
		Term:         3,
		LeaderID:     "node2",
		PrevLogIndex: 1,
		PrevLogTerm:  1,
		Entries: []LogEntry{
			{Term: 3, Index: 2, Command: "set", Data: "z=NEW"},
			{Term: 3, Index: 3, Command: "set", Data: "w=4"},
		},
		LeaderCommit: -1,
	})

	if !resp.Success {
		t.Error("should accept entries from new leader")
	}

	// BUG TEST: The conflicting entry at index 2 should be replaced
	log := node.GetLog()
	if len(log) != 4 {
		t.Errorf("expected 4 log entries, got %d", len(log))
	}
	if log[2].Data != "z=NEW" {
		t.Errorf("expected conflicting entry to be replaced with 'z=NEW', got '%s'", log[2].Data)
	}
}

func TestElectionWinWithMajority(t *testing.T) {
	// 5-node cluster: node1 + 4 peers
	node := NewRaftNode("node1", []string{"node2", "node3", "node4", "node5"})

	// 3 out of 4 peers vote yes (+ self = 4/5 majority)
	responses := []RequestVoteResponse{
		{Term: 1, VoteGranted: true},
		{Term: 1, VoteGranted: true},
		{Term: 1, VoteGranted: true},
		{Term: 1, VoteGranted: false},
	}

	won := node.StartElection(responses)
	if !won {
		t.Error("should win election with 4/5 votes")
	}

	_, state := node.GetState()
	if state != Leader {
		t.Error("should be leader after winning election")
	}
}

func TestElectionLoseWithoutMajority(t *testing.T) {
	// 5-node cluster: node1 + 4 peers
	node := NewRaftNode("node1", []string{"node2", "node3", "node4", "node5"})

	// Only 1 out of 4 peers vote yes (+ self = 2/5, not majority)
	responses := []RequestVoteResponse{
		{Term: 1, VoteGranted: true},
		{Term: 1, VoteGranted: false},
		{Term: 1, VoteGranted: false},
		{Term: 1, VoteGranted: false},
	}

	won := node.StartElection(responses)

	// BUG TEST: Should NOT win with only 2/5 votes
	// But the bug makes majority = 4/2 = 2, so 2 >= 2 passes
	if won {
		t.Error("should NOT win election with only 2/5 votes")
	}
}

func TestElectionThreeNodeCluster(t *testing.T) {
	// 3-node cluster: node1 + 2 peers
	node := NewRaftNode("node1", []string{"node2", "node3"})

	// 1 out of 2 peers vote yes (+ self = 2/3 majority)
	responses := []RequestVoteResponse{
		{Term: 1, VoteGranted: true},
		{Term: 1, VoteGranted: false},
	}

	won := node.StartElection(responses)
	if !won {
		t.Error("should win election with 2/3 votes in 3-node cluster")
	}
}

func TestProposeEntry(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})

	// Make node leader
	node.mu.Lock()
	node.state = Leader
	node.currentTerm = 1
	node.mu.Unlock()

	entry, err := node.ProposeEntry("set", "key=value")
	if err != nil {
		t.Fatalf("ProposeEntry failed: %v", err)
	}

	if entry.Term != 1 {
		t.Errorf("expected term 1, got %d", entry.Term)
	}
	if entry.Command != "set" {
		t.Errorf("expected command 'set', got '%s'", entry.Command)
	}
}

func TestProposeEntryNotLeader(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"})

	_, err := node.ProposeEntry("set", "key=value")
	if err == nil {
		t.Error("should fail when not leader")
	}
}

func TestUpdateCommitIndex(t *testing.T) {
	// 5-node cluster
	node := NewRaftNode("node1", []string{"node2", "node3", "node4", "node5"})
	node.mu.Lock()
	node.state = Leader
	node.currentTerm = 1
	node.log = []LogEntry{
		{Term: 1, Index: 0, Command: "set", Data: "x=1"},
		{Term: 1, Index: 1, Command: "set", Data: "y=2"},
		{Term: 1, Index: 2, Command: "set", Data: "z=3"},
	}
	// 3 peers have replicated up to index 2, 1 peer is behind
	node.matchIndex["node2"] = 2
	node.matchIndex["node3"] = 2
	node.matchIndex["node4"] = 2
	node.matchIndex["node5"] = 0
	node.mu.Unlock()

	node.UpdateCommitIndex()

	commitIndex := node.GetCommitIndex()
	if commitIndex != 2 {
		t.Errorf("expected commit index 2, got %d", commitIndex)
	}
}
