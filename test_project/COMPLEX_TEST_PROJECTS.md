# DSCA Complex Test Projects (20 Projects)

## Design Principles

- **Multi-language**: Python, Go, Rust, TypeScript/JavaScript, Java, C, Shell, SQL, HTML/CSS, YAML/Terraform
- **Multi-file**: Each project has 5-20+ files, requires cross-file understanding
- **Layered difficulty**: Each project has 3 phases (Setup → Fix → Extend), auto mode should handle all
- **Real-world scenarios**: Production-grade patterns, not toy problems
- **Measurable**: Each project has automated tests and clear success criteria
- **DSCA stress points**: Tests tool selection, error recovery, multi-step reasoning, context management

---

## Project 1: Full-Stack Task Manager (TypeScript + Python + SQL)

**Directory**: `complex_01_fullstack_taskmanager/`

**Description**: A React+Vite frontend, FastAPI backend, SQLite database. The project has CORS bugs, broken API contracts, SQL injection vulnerabilities, and missing features.

**Files to create**:
- `frontend/src/App.tsx` - React app with task list, create/edit/delete
- `frontend/src/api.ts` - Axios client with wrong base URL and missing error handling
- `frontend/src/components/TaskCard.tsx` - Component with key prop warning, broken CSS
- `frontend/vite.config.ts` - Missing proxy configuration
- `backend/app.py` - FastAPI with 5 bugs (CORS, SQL injection, wrong status codes, missing validation, broken pagination)
- `backend/models.py` - SQLAlchemy models with wrong column types
- `backend/database.py` - DB setup with race condition in connection pool
- `backend/requirements.txt`
- `backend/test_api.py` - pytest tests (8 tests, 5 failing)
- `schema.sql` - DDL with missing indexes and wrong constraints
- `docker-compose.yml` - Broken service configuration
- `README.md`

**Phase 1 (Auto)**: "Run the backend tests and fix all failing tests"
- Expected: Fix SQL injection, validation, status codes, pagination, CORS
- Success: All 8 tests pass

**Phase 2 (Auto)**: "Fix the frontend build errors and make it connect to the backend"
- Expected: Fix vite proxy, base URL, TypeScript errors, key props
- Success: `npm run build` succeeds, no console errors

**Phase 3 (Auto)**: "Add user authentication with JWT tokens to both frontend and backend, including tests"
- Expected: Add auth middleware, login/register endpoints, protected routes, token refresh
- Success: New auth tests pass, existing tests still pass

**DSCA Stress Points**: Cross-language debugging, understanding API contracts, security awareness

---

## Project 2: Distributed Key-Value Store (Go + Protocol Buffers)

**Directory**: `complex_02_distributed_kv/`

**Description**: A Raft-based distributed KV store with gRPC interface. Has concurrency bugs, incorrect Raft implementation, and missing persistence.

**Files to create**:
- `cmd/server/main.go` - Server entry with broken flag parsing
- `cmd/client/main.go` - CLI client with connection leak
- `internal/store/store.go` - In-memory KV with missing mutex locks (race conditions)
- `internal/store/store_test.go` - Tests including concurrent access tests
- `internal/raft/raft.go` - Simplified Raft with bugs in leader election and log replication
- `internal/raft/raft_test.go` - 12 tests, 7 failing
- `internal/transport/grpc.go` - gRPC server with wrong error codes
- `proto/kv.proto` - Protobuf definitions
- `go.mod`, `go.sum`
- `Makefile` - Build targets with wrong paths
- `config.yaml` - Cluster configuration

**Phase 1 (Auto)**: "Run `go test ./...` and fix all race conditions and failing tests"
- Expected: Add proper mutex, fix Raft election logic, fix gRPC error codes
- Success: `go test -race ./...` passes

**Phase 2 (Auto)**: "Add WAL (Write-Ahead Log) persistence so data survives restarts"
- Expected: Implement WAL with proper fsync, recovery on startup
- Success: New persistence tests pass

**Phase 3 (Auto)**: "Add TTL support for keys with automatic expiration"
- Expected: Background goroutine for cleanup, TTL in protobuf, client support
- Success: TTL tests pass, no goroutine leaks

**DSCA Stress Points**: Concurrency reasoning, protocol understanding, Go idioms

---

## Project 3: Compiler Frontend (Rust)

**Directory**: `complex_03_compiler_frontend/`

**Description**: A lexer + parser + type checker for a simple statically-typed language. Has bugs in tokenization, incorrect operator precedence, and incomplete type inference.

**Files to create**:
- `src/main.rs` - REPL entry point with broken input handling
- `src/lexer.rs` - Tokenizer with bugs in string escape handling and number parsing
- `src/parser.rs` - Recursive descent parser with wrong precedence for `&&`/`||`
- `src/ast.rs` - AST node definitions with missing Display impl
- `src/typechecker.rs` - Type checker with broken generic type unification
- `src/error.rs` - Error types with poor span tracking
- `src/tests/lexer_tests.rs` - 15 tests, 6 failing
- `src/tests/parser_tests.rs` - 20 tests, 8 failing
- `src/tests/type_tests.rs` - 10 tests, 5 failing
- `Cargo.toml`
- `examples/` - 5 example programs in the custom language

**Phase 1 (Auto)**: "Run `cargo test` and fix all failing lexer and parser tests"
- Expected: Fix string escapes, number parsing, operator precedence
- Success: All lexer and parser tests pass

**Phase 2 (Auto)**: "Fix the type checker so all type_tests pass"
- Expected: Fix generic unification, function type checking, subtyping
- Success: All type tests pass

**Phase 3 (Auto)**: "Add pattern matching support (match/case expressions) to the language with full type checking"
- Expected: New AST nodes, parser rules, exhaustiveness checking
- Success: New pattern match tests pass

**DSCA Stress Points**: Rust borrow checker, recursive algorithm debugging, language theory concepts

---

## Project 4: Real-Time Analytics Pipeline (Python + Kafka + ClickHouse)

**Directory**: `complex_04_analytics_pipeline/`

**Description**: An event ingestion pipeline with stream processing, aggregation, and dashboard. Uses mock Kafka/ClickHouse for testing.

**Files to create**:
- `ingestion/producer.py` - Event producer with schema validation bugs
- `ingestion/consumer.py` - Consumer with offset commit bugs, deserialization errors
- `ingestion/schema.py` - Avro-like schema with missing field validation
- `processing/aggregator.py` - Window-based aggregation with time zone bugs
- `processing/enricher.py` - Data enrichment with missing null handling
- `processing/test_pipeline.py` - Integration tests with mocked Kafka
- `storage/clickhouse_client.py` - ClickHouse client with SQL generation bugs
- `storage/migrations/001_create_events.sql` - DDL with wrong data types
- `dashboard/app.py` - Flask dashboard with broken WebSocket updates
- `dashboard/templates/index.html` - Dashboard HTML with XSS vulnerability
- `config/pipeline.yaml` - Configuration with wrong defaults
- `docker-compose.yml`
- `requirements.txt`
- `Makefile`

**Phase 1 (Auto)**: "Run `pytest processing/test_pipeline.py -v` and fix all failures"
- Expected: Fix schema validation, null handling, timezone bugs
- Success: All pipeline tests pass

**Phase 2 (Auto)**: "Fix the XSS vulnerability in the dashboard and the SQL injection in clickhouse_client.py"
- Expected: Sanitize HTML output, use parameterized queries
- Success: Security tests pass

**Phase 3 (Auto)**: "Add a dead letter queue for failed events with retry logic and monitoring metrics"
- Expected: DLQ implementation, exponential backoff, Prometheus metrics
- Success: DLQ tests pass, metrics endpoint works

**DSCA Stress Points**: Distributed systems concepts, security awareness, multi-service architecture

---

## Project 5: Operating System Kernel Module (C + Makefile)

**Directory**: `complex_05_kernel_module/`

**Description**: A simple virtual filesystem and memory allocator implemented in user-space C (simulating kernel concepts). Has buffer overflows, memory leaks, and race conditions.

**Files to create**:
- `src/vfs.c` - Virtual filesystem with off-by-one errors and path traversal vulnerability
- `src/vfs.h` - VFS header with wrong struct alignment
- `src/allocator.c` - Custom memory allocator (buddy system) with coalescing bug
- `src/allocator.h` - Allocator interface
- `src/scheduler.c` - Simple round-robin scheduler with priority inversion
- `src/scheduler.h`
- `src/ipc.c` - Inter-process communication with deadlock potential
- `src/ipc.h`
- `tests/test_vfs.c` - VFS tests using check framework (or simple assert-based)
- `tests/test_allocator.c` - Allocator tests with fragmentation scenarios
- `tests/test_scheduler.c` - Scheduler tests
- `Makefile` - With wrong compiler flags and missing sanitizer options
- `README.md`

**Phase 1 (Auto)**: "Compile the project and fix all compiler warnings and errors. Run tests."
- Expected: Fix includes, struct issues, compilation errors
- Success: `make all` and `make test` succeed with zero warnings

**Phase 2 (Auto)**: "Fix the buffer overflow in vfs.c and the memory leak in allocator.c. Enable AddressSanitizer."
- Expected: Bounds checking, proper free() calls, ASan integration
- Success: Tests pass under ASan with no errors

**Phase 3 (Auto)**: "Add a simple journaling mechanism to the VFS for crash recovery"
- Expected: Write-ahead journal, checkpoint/recovery, fsync semantics
- Success: Journal tests pass including simulated crash scenarios

**DSCA Stress Points**: C memory safety, low-level debugging, understanding system concepts

---

## Project 6: Machine Learning Model Server (Python + C++ Extension)

**Directory**: `complex_06_ml_server/`

**Description**: A model serving system with a Python FastAPI frontend and C++ inference backend via pybind11. Has numerical bugs, memory management issues, and broken batching.

**Files to create**:
- `server/app.py` - FastAPI with model loading, prediction endpoints
- `server/batch_processor.py` - Request batching with race condition and wrong timeout
- `server/model_registry.py` - Model version management with broken rollback
- `server/test_server.py` - API tests
- `inference/engine.cpp` - C++ inference with numerical instability (overflow in softmax)
- `inference/engine.h`
- `inference/bindings.cpp` - pybind11 bindings with wrong type conversions
- `inference/CMakeLists.txt`
- `inference/test_engine.cpp` - C++ unit tests
- `models/config.yaml` - Model configurations with wrong shapes
- `scripts/benchmark.py` - Benchmark script with measuring bugs
- `requirements.txt`
- `Makefile`

**Phase 1 (Auto)**: "Fix the C++ compilation errors and numerical bugs in engine.cpp. Run the C++ tests."
- Expected: Fix softmax overflow (log-sum-exp trick), fix type issues
- Success: C++ tests pass with correct numerical results

**Phase 2 (Auto)**: "Fix the Python server tests - focus on batch processing and model registry"
- Expected: Fix race condition, timeout logic, rollback mechanism
- Success: All Python tests pass

**Phase 3 (Auto)**: "Add model A/B testing support with traffic splitting and metrics collection"
- Expected: Weighted routing, metrics tracking, statistical significance testing
- Success: A/B test scenarios pass

**DSCA Stress Points**: Cross-language (C++/Python), numerical computing, build systems

---

## Project 7: Blockchain Smart Contract System (Rust + TypeScript)

**Directory**: `complex_07_blockchain/`

**Description**: A simple blockchain with smart contract execution, consensus, and a TypeScript SDK. Has cryptographic bugs, consensus issues, and broken contract execution.

**Files to create**:
- `chain/src/block.rs` - Block structure with wrong hash computation
- `chain/src/blockchain.rs` - Chain management with fork choice bug
- `chain/src/consensus.rs` - PoS consensus with broken validator selection
- `chain/src/vm.rs` - Simple stack-based VM with integer overflow in arithmetic
- `chain/src/contract.rs` - Smart contract execution with reentrancy vulnerability
- `chain/src/crypto.rs` - Signature verification with timing attack vulnerability
- `chain/src/lib.rs`
- `chain/src/tests/` - Comprehensive test suite (30+ tests)
- `chain/Cargo.toml`
- `sdk/src/client.ts` - TypeScript SDK with wrong serialization
- `sdk/src/types.ts` - Type definitions out of sync with Rust
- `sdk/src/contract.ts` - Contract deployment/interaction
- `sdk/package.json`, `sdk/tsconfig.json`
- `sdk/tests/client.test.ts`

**Phase 1 (Auto)**: "Run `cargo test` in the chain directory and fix all failing tests"
- Expected: Fix hash computation, fork choice, validator selection
- Success: All Rust tests pass

**Phase 2 (Auto)**: "Fix the reentrancy vulnerability in contract.rs and the timing attack in crypto.rs"
- Expected: Add reentrancy guard, use constant-time comparison
- Success: Security tests pass

**Phase 3 (Auto)**: "Implement ERC-20 like token contract support in the VM with transfer, approve, and allowance operations"
- Expected: New VM opcodes, contract standard, SDK support
- Success: Token contract tests pass in both Rust and TypeScript

**DSCA Stress Points**: Cryptography, security vulnerabilities, cross-language type sync

---

## Project 8: Database Engine (Go)

**Directory**: `complex_08_database_engine/`

**Description**: A simple SQL database engine with B+Tree index, query parser, and execution engine. Has data corruption bugs, wrong query optimization, and broken transactions.

**Files to create**:
- `cmd/db/main.go` - Database server entry point
- `internal/parser/lexer.go` - SQL lexer with keyword collision
- `internal/parser/parser.go` - SQL parser with wrong JOIN precedence
- `internal/parser/ast.go` - AST types
- `internal/parser/parser_test.go` - Parser tests
- `internal/storage/btree.go` - B+Tree with broken node splitting
- `internal/storage/btree_test.go` - B+Tree tests with edge cases
- `internal/storage/page.go` - Page management with alignment bugs
- `internal/storage/wal.go` - WAL with broken checksum
- `internal/executor/executor.go` - Query executor with wrong NULL semantics
- `internal/executor/executor_test.go`
- `internal/optimizer/planner.go` - Query planner with missing index selection
- `internal/txn/manager.go` - Transaction manager with phantom read bug
- `internal/txn/manager_test.go`
- `go.mod`

**Phase 1 (Auto)**: "Run `go test ./...` and fix all test failures"
- Expected: Fix B+Tree splitting, parser precedence, NULL handling
- Success: All tests pass

**Phase 2 (Auto)**: "Fix the transaction isolation bugs and add proper MVCC"
- Expected: Implement MVCC, fix phantom reads, serializable isolation
- Success: Isolation level tests pass

**Phase 3 (Auto)**: "Add aggregate functions (COUNT, SUM, AVG, MIN, MAX) and GROUP BY support"
- Expected: New AST nodes, executor logic, optimizer rules
- Success: Aggregate query tests pass

**DSCA Stress Points**: Complex data structures, SQL semantics, transaction theory

---

## Project 9: Container Runtime (Go + Shell)

**Directory**: `complex_09_container_runtime/`

**Description**: A minimal container runtime using Linux namespaces (user-space simulation). Has namespace isolation bugs, broken cgroup management, and incorrect image layering.

**Files to create**:
- `cmd/runtime/main.go` - CLI entry point
- `internal/container/create.go` - Container creation with broken namespace setup
- `internal/container/exec.go` - Process execution with missing capability drops
- `internal/container/lifecycle.go` - Start/stop/delete with resource leak
- `internal/image/layer.go` - Image layer management with wrong overlay merge
- `internal/image/pull.go` - Mock image pull with checksum bug
- `internal/image/layer_test.go`
- `internal/network/bridge.go` - Network bridge with IP allocation collision
- `internal/network/bridge_test.go`
- `internal/cgroup/manager.go` - Cgroup management with wrong memory limit parsing
- `internal/cgroup/manager_test.go`
- `internal/spec/config.go` - OCI spec parsing with missing validation
- `scripts/setup_rootfs.sh` - Root filesystem setup script with permission bugs
- `go.mod`
- `Makefile`

**Phase 1 (Auto)**: "Run all tests and fix failures. Focus on image layer management and cgroup tests"
- Expected: Fix overlay merge, memory limit parsing, checksum validation
- Success: All tests pass

**Phase 2 (Auto)**: "Fix the IP allocation collision in network/bridge.go and add proper cleanup"
- Expected: IP pool management, lease tracking, cleanup on container stop
- Success: Network tests pass including concurrent container scenarios

**Phase 3 (Auto)**: "Add resource monitoring - CPU/memory/network stats collection with a stats API"
- Expected: Stats collection goroutines, REST API, graceful shutdown
- Success: Stats tests pass, no goroutine leaks

**DSCA Stress Points**: Linux concepts, resource management, concurrent Go patterns

---

## Project 10: GraphQL API Gateway (TypeScript + Node.js)

**Directory**: `complex_10_graphql_gateway/`

**Description**: A GraphQL federation gateway that merges multiple subgraph schemas. Has schema stitching bugs, N+1 query problems, broken authentication, and caching issues.

**Files to create**:
- `src/gateway.ts` - Main gateway with broken schema composition
- `src/schema/stitch.ts` - Schema stitching with type conflict resolution bugs
- `src/schema/federation.ts` - Federation directive handling with wrong entity resolution
- `src/resolvers/user.ts` - User resolver with N+1 problem
- `src/resolvers/product.ts` - Product resolver with broken DataLoader
- `src/resolvers/order.ts` - Order resolver with circular dependency
- `src/auth/jwt.ts` - JWT validation with algorithm confusion vulnerability
- `src/auth/rbac.ts` - Role-based access with broken inheritance
- `src/cache/redis.ts` - Redis cache with wrong TTL and serialization bugs
- `src/middleware/rateLimit.ts` - Rate limiter with race condition
- `src/middleware/logging.ts` - Request logging with PII leak
- `src/__tests__/gateway.test.ts` - Gateway integration tests
- `src/__tests__/auth.test.ts` - Auth tests
- `src/__tests__/resolvers.test.ts` - Resolver tests
- `package.json`, `tsconfig.json`
- `schema.graphql` - Full GraphQL schema

**Phase 1 (Auto)**: "Run `npm test` and fix all test failures"
- Expected: Fix schema stitching, entity resolution, DataLoader
- Success: All tests pass

**Phase 2 (Auto)**: "Fix the JWT algorithm confusion vulnerability and the PII leak in logging"
- Expected: Pin algorithm in JWT verify, redact sensitive fields in logs
- Success: Security tests pass

**Phase 3 (Auto)**: "Add query complexity analysis and automatic persisted queries (APQ)"
- Expected: Complexity scoring, query depth limiting, APQ with cache
- Success: Complexity and APQ tests pass

**DSCA Stress Points**: GraphQL concepts, security patterns, TypeScript generics

---

## Project 11: Game Engine ECS (C++ + Lua)

**Directory**: `complex_11_game_ecs/`

**Description**: An Entity-Component-System game engine with Lua scripting. Has memory management bugs, broken system scheduling, and incorrect physics calculations.

**Files to create**:
- `src/ecs/world.cpp/.h` - World management with dangling pointer on entity delete
- `src/ecs/entity.cpp/.h` - Entity with component bitmask overflow
- `src/ecs/component_pool.cpp/.h` - Pool allocator with fragmentation bug
- `src/ecs/system.cpp/.h` - System scheduler with wrong dependency ordering
- `src/physics/collision.cpp/.h` - AABB collision with floating point comparison bug
- `src/physics/rigidbody.cpp/.h` - Physics integration with energy non-conservation
- `src/scripting/lua_bridge.cpp/.h` - Lua binding with stack corruption
- `src/scripting/scripts/enemy_ai.lua` - AI script with logic bugs
- `src/rendering/sprite.cpp/.h` - Sprite rendering with wrong Z-ordering
- `tests/test_ecs.cpp` - ECS tests
- `tests/test_physics.cpp` - Physics tests
- `tests/test_scripting.cpp` - Scripting tests
- `CMakeLists.txt`
- `scripts/build.sh`

**Phase 1 (Auto)**: "Fix compilation errors, then run tests and fix all failures"
- Expected: Fix dangling pointers, bitmask overflow, pool fragmentation
- Success: All ECS tests pass under Valgrind/ASan

**Phase 2 (Auto)**: "Fix the physics bugs - energy conservation and floating point collision issues"
- Expected: Use symplectic Euler, epsilon comparison, proper AABB overlap
- Success: Physics tests pass with energy conservation within tolerance

**Phase 3 (Auto)**: "Add a spatial hash grid for broad-phase collision detection"
- Expected: Grid-based spatial partitioning, entity tracking, query API
- Success: Spatial hash tests pass, benchmarks show improvement

**DSCA Stress Points**: C++ memory management, numerical computing, game development patterns

---

## Project 12: Microservices Observability Platform (Go + Python + TypeScript)

**Directory**: `complex_12_observability/`

**Description**: A distributed tracing + metrics + logging platform with 3 services. Has trace propagation bugs, metric aggregation errors, and broken alert rules.

**Files to create**:
- `collector/main.go` - Trace collector with broken OTLP ingestion
- `collector/span_processor.go` - Span processing with wrong parent-child linking
- `collector/span_processor_test.go`
- `collector/go.mod`
- `aggregator/aggregator.py` - Metric aggregation with histogram bucket boundary errors
- `aggregator/alert_engine.py` - Alert evaluation with broken threshold comparison
- `aggregator/test_aggregator.py`
- `aggregator/requirements.txt`
- `dashboard/src/App.tsx` - React dashboard with broken trace waterfall view
- `dashboard/src/components/TraceView.tsx` - Trace visualization with wrong span ordering
- `dashboard/src/components/MetricChart.tsx` - Chart with wrong time series alignment
- `dashboard/src/hooks/useMetrics.ts` - Hook with memory leak (no cleanup)
- `dashboard/src/__tests__/TraceView.test.tsx`
- `dashboard/package.json`, `dashboard/tsconfig.json`
- `proto/telemetry.proto` - Shared protobuf definitions
- `docker-compose.yml`

**Phase 1 (Auto)**: "Run tests in collector/ and aggregator/ and fix all failures"
- Expected: Fix span linking, histogram boundaries, alert thresholds
- Success: Go and Python tests pass

**Phase 2 (Auto)**: "Fix the trace waterfall rendering and the memory leak in useMetrics hook"
- Expected: Correct span ordering, proper useEffect cleanup
- Success: Dashboard tests pass, no memory leak warnings

**Phase 3 (Auto)**: "Add distributed context propagation with W3C TraceContext format across all 3 services"
- Expected: Implement W3C traceparent/tracestate headers, propagation in all services
- Success: End-to-end trace tests pass

**DSCA Stress Points**: 3-language project, distributed systems concepts, observability domain knowledge

---

## Project 13: Static Site Generator (Rust + Handlebars)

**Directory**: `complex_13_static_site_gen/`

**Description**: A Markdown-to-HTML static site generator with templating, live reload, and plugin system. Has Markdown parsing bugs, template rendering issues, and broken incremental builds.

**Files to create**:
- `src/main.rs` - CLI entry with broken argument parsing
- `src/parser/markdown.rs` - Markdown parser with wrong list nesting and code block handling
- `src/parser/frontmatter.rs` - YAML frontmatter with broken date parsing
- `src/template/engine.rs` - Handlebars-like engine with wrong variable escaping
- `src/template/helpers.rs` - Template helpers with broken date formatting
- `src/builder/incremental.rs` - Incremental build with wrong dependency graph
- `src/builder/assets.rs` - Asset pipeline with broken CSS minification
- `src/server/livereload.rs` - Dev server with WebSocket connection drop
- `src/plugin/loader.rs` - Plugin system with wrong lifecycle hooks
- `src/tests/` - Test files for each module
- `content/` - Sample site content (3 posts, 2 pages)
- `templates/` - Handlebars templates with errors
- `Cargo.toml`

**Phase 1 (Auto)**: "Run `cargo test` and fix all parser and template test failures"
- Expected: Fix list nesting, code blocks, variable escaping, date formatting
- Success: Parser and template tests pass

**Phase 2 (Auto)**: "Fix the incremental build dependency tracking so only changed files rebuild"
- Expected: Correct dependency graph, proper invalidation, content hash comparison
- Success: Incremental build tests pass

**Phase 3 (Auto)**: "Add RSS feed generation and full-text search index (JSON-based)"
- Expected: Valid RSS XML output, inverted index for search, integration tests
- Success: RSS and search tests pass

**DSCA Stress Points**: Rust string processing, template engine concepts, build system logic

---

## Project 14: Network Protocol Analyzer (Python + C Extension)

**Directory**: `complex_14_packet_analyzer/`

**Description**: A network packet analyzer with protocol dissection, flow reconstruction, and anomaly detection. Uses C extension for packet parsing performance.

**Files to create**:
- `analyzer/capture.py` - Packet capture with broken BPF filter construction
- `analyzer/dissector.py` - Protocol dissection with wrong TCP reassembly
- `analyzer/flow.py` - Flow tracking with timeout handling bug
- `analyzer/anomaly.py` - Anomaly detection with broken baseline calculation
- `analyzer/export.py` - PCAP export with endianness bug
- `analyzer/test_dissector.py` - Dissector tests with sample packets
- `analyzer/test_flow.py` - Flow reconstruction tests
- `analyzer/test_anomaly.py` - Anomaly detection tests
- `ext/parser.c` - C extension for fast packet header parsing with buffer overflow
- `ext/parser.h`
- `ext/setup.py` - C extension build
- `rules/signatures.yaml` - Detection signatures with regex bugs
- `pcap_samples/` - Sample PCAP files (hex-encoded for testing)
- `requirements.txt`

**Phase 1 (Auto)**: "Run `pytest -v` and fix all test failures in dissector and flow tests"
- Expected: Fix TCP reassembly, flow timeout, BPF filters
- Success: Dissector and flow tests pass

**Phase 2 (Auto)**: "Fix the buffer overflow in the C extension and the endianness bug in export"
- Expected: Bounds checking in C, proper byte order handling
- Success: Tests pass under ASan, export tests pass

**Phase 3 (Auto)**: "Add HTTP/2 protocol dissection with HPACK header decompression"
- Expected: HTTP/2 frame parsing, HPACK huffman decoding, stream tracking
- Success: HTTP/2 dissection tests pass

**DSCA Stress Points**: Binary protocol parsing, C extension development, network concepts

---

## Project 15: Infrastructure as Code Platform (TypeScript + Terraform + Shell)

**Directory**: `complex_15_iac_platform/`

**Description**: A Terraform wrapper that adds policy enforcement, drift detection, and cost estimation. Has HCL parsing bugs, broken state management, and incorrect cost calculations.

**Files to create**:
- `src/parser/hcl.ts` - HCL parser with wrong block nesting and expression evaluation
- `src/parser/hcl.test.ts` - Parser tests
- `src/policy/engine.ts` - OPA-like policy engine with broken rule evaluation
- `src/policy/rules/security.ts` - Security rules with wrong S3 bucket policy check
- `src/policy/engine.test.ts`
- `src/drift/detector.ts` - Drift detection with wrong state comparison (deep equality bug)
- `src/drift/detector.test.ts`
- `src/cost/estimator.ts` - Cost calculation with wrong EC2/RDS pricing lookup
- `src/cost/pricing.json` - Pricing data with wrong regions
- `src/cost/estimator.test.ts`
- `src/state/manager.ts` - State file management with concurrent write corruption
- `src/state/lock.ts` - State locking with broken advisory lock
- `scripts/plan.sh` - Plan execution script with broken error handling
- `scripts/apply.sh` - Apply script with missing rollback
- `terraform/examples/` - Sample Terraform configs with intentional violations
- `package.json`, `tsconfig.json`

**Phase 1 (Auto)**: "Run `npm test` and fix all test failures"
- Expected: Fix HCL parsing, policy evaluation, drift detection, cost estimation
- Success: All tests pass

**Phase 2 (Auto)**: "Fix the state manager concurrent write issue and add proper locking"
- Expected: File-based advisory locking, atomic writes, stale lock detection
- Success: Concurrent state tests pass

**Phase 3 (Auto)**: "Add Terraform module dependency graphing with circular dependency detection"
- Expected: DAG construction from module refs, cycle detection, visualization output
- Success: Dependency graph tests pass including cycle detection

**DSCA Stress Points**: Infrastructure concepts, HCL/Terraform domain knowledge, concurrency

---

## Project 16: Audio Processing Library (Rust + Python bindings)

**Directory**: `complex_16_audio_processing/`

**Description**: An audio DSP library in Rust with PyO3 Python bindings. Has FFT bugs, filter coefficient errors, and broken real-time audio streaming.

**Files to create**:
- `src/lib.rs` - Library root
- `src/fft.rs` - FFT implementation with wrong bit-reversal permutation
- `src/filter.rs` - IIR/FIR filters with wrong coefficient calculation (butterworth)
- `src/effects.rs` - Audio effects (reverb, delay, chorus) with feedback loop instability
- `src/io/wav.rs` - WAV file reading with wrong sample format detection
- `src/io/stream.rs` - Real-time audio stream with buffer underrun handling
- `src/resample.rs` - Sample rate conversion with aliasing artifacts
- `src/tests/` - Comprehensive tests with known signal processing results
- `python/audio_lib.pyi` - Python type stubs
- `python/bindings.rs` - PyO3 bindings with wrong lifetime management
- `python/test_audio.py` - Python integration tests
- `Cargo.toml`
- `pyproject.toml`

**Phase 1 (Auto)**: "Run `cargo test` and fix FFT, filter, and WAV file test failures"
- Expected: Fix bit-reversal, Butterworth coefficients, WAV format detection
- Success: Core audio tests pass with numerical accuracy

**Phase 2 (Auto)**: "Fix the reverb feedback instability and sample rate conversion aliasing"
- Expected: Clamp feedback, add anti-aliasing filter before resampling
- Success: Effects and resample tests pass

**Phase 3 (Auto)**: "Add real-time spectrum analyzer with peak detection and Python API"
- Expected: Sliding window FFT, peak picking algorithm, Python bindings
- Success: Spectrum analyzer tests pass in both Rust and Python

**DSCA Stress Points**: DSP mathematics, Rust/Python interop, numerical precision

---

## Project 17: Git Implementation (Go)

**Directory**: `complex_17_git_impl/`

**Description**: A simplified Git implementation that supports init, add, commit, branch, merge, and diff. Has object hashing bugs, broken merge algorithm, and incorrect diff output.

**Files to create**:
- `cmd/mygit/main.go` - CLI entry point
- `internal/object/blob.go` - Blob object with wrong content hashing
- `internal/object/tree.go` - Tree object with broken sorting
- `internal/object/commit.go` - Commit with wrong parent chain
- `internal/object/object_test.go`
- `internal/index/index.go` - Staging area with path normalization bug
- `internal/index/index_test.go`
- `internal/refs/refs.go` - Reference management with symref loop
- `internal/diff/myers.go` - Myers diff with wrong shortest edit script
- `internal/diff/diff_test.go`
- `internal/merge/three_way.go` - Three-way merge with broken conflict detection
- `internal/merge/merge_test.go`
- `internal/pack/packfile.go` - Packfile with wrong delta encoding
- `go.mod`

**Phase 1 (Auto)**: "Run `go test ./...` and fix all object and index test failures"
- Expected: Fix SHA1 hashing, tree entry sorting, path normalization
- Success: Object and index tests pass

**Phase 2 (Auto)**: "Fix the Myers diff algorithm and the three-way merge conflict detection"
- Expected: Correct shortest edit script, proper conflict markers
- Success: Diff and merge tests pass

**Phase 3 (Auto)**: "Add interactive rebase support (reorder, squash, edit commit messages)"
- Expected: Todo list parsing, commit replay, squash merging
- Success: Rebase tests pass

**DSCA Stress Points**: Algorithm implementation (Myers diff), Git internals, binary format handling

---

## Project 18: Distributed Task Queue (Python + Redis + Go Worker)

**Directory**: `complex_18_task_queue/`

**Description**: A Celery-like task queue with Python API, Redis broker, and Go worker. Has task serialization bugs, broken retry logic, and incorrect priority scheduling.

**Files to create**:
- `broker/client.py` - Redis-based broker with broken message acknowledgment
- `broker/serializer.py` - Task serialization with datetime handling bug
- `broker/priority_queue.py` - Priority scheduling with wrong heap ordering
- `broker/test_broker.py`
- `api/tasks.py` - Task definition DSL with broken decorator chain
- `api/canvas.py` - Task composition (chain, group, chord) with broken chord callback
- `api/result.py` - Result backend with race condition in result setting
- `api/test_canvas.py`
- `worker/main.go` - Go worker with task execution and heartbeat
- `worker/executor.go` - Task execution with panic recovery bug
- `worker/pool.go` - Worker pool with broken graceful shutdown
- `worker/worker_test.go`
- `worker/go.mod`
- `monitoring/dashboard.py` - Flask monitoring dashboard
- `requirements.txt`
- `docker-compose.yml`

**Phase 1 (Auto)**: "Run `pytest` in broker/ and api/ and fix all failures. Run `go test` in worker/"
- Expected: Fix serialization, priority queue, chord callback, panic recovery
- Success: All Python and Go tests pass

**Phase 2 (Auto)**: "Fix the message acknowledgment bug and the result backend race condition"
- Expected: Proper ack after processing, atomic result setting with locks
- Success: Reliability tests pass

**Phase 3 (Auto)**: "Add task rate limiting with token bucket algorithm and per-queue concurrency control"
- Expected: Token bucket implementation, configurable rate limits, queue-level concurrency
- Success: Rate limiting tests pass

**DSCA Stress Points**: Cross-language message passing, distributed systems, Go/Python interop

---

## Project 19: Code Search Engine (Rust + TypeScript UI)

**Directory**: `complex_19_code_search/`

**Description**: A code search engine with trigram indexing, regex support, and a web UI. Has indexing bugs, wrong ranking algorithm, and broken syntax highlighting.

**Files to create**:
- `indexer/src/main.rs` - Indexer binary
- `indexer/src/trigram.rs` - Trigram index with wrong UTF-8 handling
- `indexer/src/crawler.rs` - File crawler with broken gitignore parsing
- `indexer/src/ranking.rs` - TF-IDF ranking with wrong document frequency
- `indexer/src/storage.rs` - Index storage with broken mmap handling
- `indexer/src/regex_engine.rs` - NFA-based regex with wrong character class handling
- `indexer/src/tests/` - Indexer tests
- `indexer/Cargo.toml`
- `server/src/api.ts` - Search API server
- `server/src/query_parser.ts` - Query language parser with wrong operator precedence
- `server/src/highlighter.ts` - Code syntax highlighting with broken state machine
- `server/src/__tests__/` - Server tests
- `server/package.json`, `server/tsconfig.json`
- `ui/src/App.tsx` - Search UI with debounced search
- `ui/src/components/ResultList.tsx` - Results with broken pagination
- `ui/src/components/CodePreview.tsx` - Code preview with wrong line numbering
- `ui/package.json`

**Phase 1 (Auto)**: "Run `cargo test` in indexer/ and `npm test` in server/. Fix all failures"
- Expected: Fix trigram UTF-8, gitignore parsing, query operator precedence
- Success: Rust and TypeScript tests pass

**Phase 2 (Auto)**: "Fix the ranking algorithm to properly compute TF-IDF scores and add BM25 support"
- Expected: Correct document frequency, implement BM25 scoring, update tests
- Success: Ranking tests pass with known expected scores

**Phase 3 (Auto)**: "Add incremental index updates for file changes without full re-index"
- Expected: Diff-based index updates, file watcher integration, consistency guarantees
- Success: Incremental update tests pass

**DSCA Stress Points**: Information retrieval algorithms, regex implementation, Rust/TS project

---

## Project 20: End-to-End Encrypted Chat (Go + TypeScript + WebAssembly)

**Directory**: `complex_20_e2ee_chat/`

**Description**: An encrypted chat app with Signal Protocol-like encryption, Go server, TypeScript client, and Rust-compiled WASM crypto module. Has cryptographic bugs, protocol state machine errors, and broken key exchange.

**Files to create**:
- `server/main.go` - WebSocket server with broken connection management
- `server/handler.go` - Message routing with wrong delivery guarantees
- `server/store.go` - Message store with broken key bundle serving
- `server/handler_test.go`
- `server/go.mod`
- `crypto/src/lib.rs` - Rust crypto with wrong X3DH key exchange
- `crypto/src/double_ratchet.rs` - Double Ratchet with broken chain key derivation
- `crypto/src/session.rs` - Session management with wrong message ordering
- `crypto/src/tests/` - Crypto tests
- `crypto/Cargo.toml`
- `client/src/client.ts` - Chat client with broken WebSocket reconnection
- `client/src/protocol.ts` - Protocol handler with wrong message type dispatching
- `client/src/crypto_wasm.ts` - WASM bindings for crypto module
- `client/src/store.ts` - IndexedDB storage with broken key persistence
- `client/src/__tests__/protocol.test.ts`
- `client/package.json`, `client/tsconfig.json`
- `proto/messages.proto` - Message format definitions

**Phase 1 (Auto)**: "Run `cargo test` in crypto/ and `go test` in server/. Fix all failures"
- Expected: Fix X3DH key exchange, chain key derivation, connection management
- Success: Crypto and server tests pass

**Phase 2 (Auto)**: "Fix message ordering in the Double Ratchet and the WebSocket reconnection logic"
- Expected: Proper message counter, out-of-order message handling, exponential backoff reconnect
- Success: Protocol tests pass including out-of-order scenarios

**Phase 3 (Auto)**: "Add group chat support with Sender Keys protocol"
- Expected: Sender key distribution, group session management, member add/remove
- Success: Group chat tests pass

**DSCA Stress Points**: Cryptographic protocols, 3-language + WASM project, state machine correctness

---

## Summary Matrix

| # | Project | Languages | Files | Phase 1 Tests | Phase 2 Tests | Phase 3 Tests | Key DSCA Challenges |
|---|---------|-----------|-------|---------------|---------------|---------------|---------------------|
| 1 | Full-Stack Task Manager | TS+Py+SQL | 12 | 8 | Build pass | Auth tests | Cross-language API contracts |
| 2 | Distributed KV Store | Go+Proto | 11 | Race tests | WAL tests | TTL tests | Concurrency, protocols |
| 3 | Compiler Frontend | Rust | 12 | 29 | 10 | Pattern tests | Algorithms, Rust borrow checker |
| 4 | Analytics Pipeline | Py+SQL | 14 | Pipeline tests | Security tests | DLQ tests | Distributed systems, security |
| 5 | Kernel Module | C | 13 | Build+test | ASan clean | Journal tests | C memory safety |
| 6 | ML Model Server | Py+C++ | 12 | C++ tests | Py tests | A/B tests | C++/Py, numerical computing |
| 7 | Blockchain | Rust+TS | 15 | 30+ | Security tests | Token tests | Cryptography, cross-lang |
| 8 | Database Engine | Go | 14 | All tests | MVCC tests | Aggregate tests | Data structures, SQL |
| 9 | Container Runtime | Go+Shell | 14 | Image/cgroup | Network tests | Stats tests | Linux concepts, Go |
| 10 | GraphQL Gateway | TypeScript | 16 | All tests | Security tests | APQ tests | GraphQL, security |
| 11 | Game Engine ECS | C+++Lua | 14 | ECS tests | Physics tests | Spatial hash | C++ memory, game dev |
| 12 | Observability | Go+Py+TS | 15 | Backend tests | Dashboard tests | Trace propagation | 3-language, distributed |
| 13 | Static Site Gen | Rust | 14 | Parser tests | Build tests | RSS/search | Rust strings, build systems |
| 14 | Packet Analyzer | Py+C | 14 | Dissector tests | Security tests | HTTP/2 tests | Binary parsing, C ext |
| 15 | IaC Platform | TS+Shell | 16 | All tests | State tests | Dep graph | Infrastructure, concurrency |
| 16 | Audio Processing | Rust+Py | 13 | DSP tests | Effects tests | Spectrum tests | DSP math, Rust/Py interop |
| 17 | Git Implementation | Go | 13 | Object tests | Diff/merge | Rebase tests | Algorithms, binary formats |
| 18 | Task Queue | Py+Go | 15 | All tests | Reliability | Rate limit | Cross-lang, distributed |
| 19 | Code Search | Rust+TS | 16 | Index tests | Ranking tests | Incremental | IR algorithms, Rust/TS |
| 20 | E2EE Chat | Go+TS+Rust+WASM | 16 | Crypto tests | Protocol tests | Group chat | Crypto, 3-lang+WASM |

## DSCA Capability Coverage

| Capability | Projects Testing It |
|-----------|-------------------|
| Multi-file editing | ALL |
| Cross-language reasoning | 1, 6, 7, 12, 14, 16, 18, 19, 20 |
| Security vulnerability detection | 1, 4, 5, 7, 10, 14, 20 |
| Concurrency bug fixing | 2, 5, 8, 9, 10, 15, 18 |
| Algorithm implementation | 3, 8, 11, 13, 16, 17, 19 |
| Test-driven development | ALL |
| Build system handling | 5, 6, 11, 14, 16 |
| Error recovery / retry | ALL (via phased testing) |
| Domain-specific knowledge | 2(distributed), 3(compilers), 8(databases), 9(containers), 16(DSP), 20(crypto) |
| Large context management | 7, 12, 15, 19, 20 (15+ files) |

## Execution Plan

### Phase 1: Create all 20 projects (scaffold)
Generate all source files with intentional bugs, tests, and configurations.

### Phase 2: Baseline testing
Run each project's Phase 1 task through DSCA auto mode, record:
- Success/failure
- Number of iterations needed
- Token usage
- Time to completion
- Which tools were used

### Phase 3: Iterative optimization
For each failure:
1. Identify the root cause in DSCA (tool selection? context loss? wrong reasoning?)
2. Fix the issue in DSCA core/tools/prompts
3. Re-run the failed project
4. Run regression on previously passing projects

### Phase 4: Progressive difficulty
Move to Phase 2 and Phase 3 tasks, repeat optimization cycle.

## DSCA Test Command Template

```bash
DSCA="node /Users/baidu/Downloads/dsca/packages/cli/dist/index.js"

# Run a specific project test
$DSCA --confirm-all -w test_project/complex_01_fullstack_taskmanager \
  "Run the backend tests and fix all failing tests"

# Run with verbose logging for debugging
DSCA_LOG_LEVEL=debug $DSCA --confirm-all -w test_project/complex_02_distributed_kv \
  "Run go test ./... and fix all race conditions and failing tests"

# Run in plan mode for Phase 3 tasks
$DSCA --mode plan --confirm-all -w test_project/complex_03_compiler_frontend \
  "Add pattern matching support (match/case expressions) to the language with full type checking"
```

## Automated Test Runner

```bash
#!/bin/bash
# run_all_tests.sh - Automated DSCA test runner

DSCA="node /Users/baidu/Downloads/dsca/packages/cli/dist/index.js"
RESULTS_DIR="test_results/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RESULTS_DIR"

declare -A PROJECTS
PROJECTS[complex_01]="Run the backend tests and fix all failing tests"
PROJECTS[complex_02]="Run go test ./... and fix all race conditions and failing tests"
PROJECTS[complex_03]="Run cargo test and fix all failing lexer and parser tests"
PROJECTS[complex_04]="Run pytest processing/test_pipeline.py -v and fix all failures"
PROJECTS[complex_05]="Compile the project and fix all compiler warnings and errors. Run tests."
PROJECTS[complex_06]="Fix the C++ compilation errors and numerical bugs in engine.cpp. Run the C++ tests."
PROJECTS[complex_07]="Run cargo test in the chain directory and fix all failing tests"
PROJECTS[complex_08]="Run go test ./... and fix all test failures"
PROJECTS[complex_09]="Run all tests and fix failures. Focus on image layer management and cgroup tests"
PROJECTS[complex_10]="Run npm test and fix all test failures"
PROJECTS[complex_11]="Fix compilation errors, then run tests and fix all failures"
PROJECTS[complex_12]="Run tests in collector/ and aggregator/ and fix all failures"
PROJECTS[complex_13]="Run cargo test and fix all parser and template test failures"
PROJECTS[complex_14]="Run pytest -v and fix all test failures in dissector and flow tests"
PROJECTS[complex_15]="Run npm test and fix all test failures"
PROJECTS[complex_16]="Run cargo test and fix FFT, filter, and WAV file test failures"
PROJECTS[complex_17]="Run go test ./... and fix all object and index test failures"
PROJECTS[complex_18]="Run pytest in broker/ and api/ and fix all failures. Run go test in worker/"
PROJECTS[complex_19]="Run cargo test in indexer/ and npm test in server/. Fix all failures"
PROJECTS[complex_20]="Run cargo test in crypto/ and go test in server/. Fix all failures"

for project in "${!PROJECTS[@]}"; do
  echo "=== Testing $project ==="
  dir=$(find test_project -maxdepth 1 -name "${project}*" -type d)
  if [ -z "$dir" ]; then
    echo "SKIP: $project directory not found"
    continue
  fi

  start_time=$(date +%s)
  $DSCA --confirm-all -w "$dir" "${PROJECTS[$project]}" \
    > "$RESULTS_DIR/${project}.log" 2>&1
  exit_code=$?
  end_time=$(date +%s)

  echo "$project: exit=$exit_code, time=$((end_time - start_time))s" \
    >> "$RESULTS_DIR/summary.txt"
done

echo "=== Results in $RESULTS_DIR/summary.txt ==="
cat "$RESULTS_DIR/summary.txt"
```
