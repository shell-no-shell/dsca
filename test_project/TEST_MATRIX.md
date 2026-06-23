# DSCA Test Matrix

## Test Projects Overview

| Project | Language | Complexity | Bugs | TODOs | Test File |
|---------|----------|-----------|------|-------|-----------|
| python_basic | Python | L1-L2 | 3 | 7 | test_calculator.py |
| python_web | Python | L2-L3 | 3 | 5 | (needs creation) |
| js_node | JavaScript | L2-L3 | 4 | 8 | linked-list.test.js, event-emitter.test.js |
| go_api | Go | L2-L3 | 5 | 6 | main_test.go |
| java_basic | Java | L1-L2 | 3 | 5 | StringProcessorTest.java |
| shell_scripts | Bash | L1-L2 | 6 | 9 | test_deploy.sh |
| html_css | HTML/CSS/JS | L1-L2 | 12 | 11 | (manual review) |

## Test Levels

### L1 - Environment Detection & Simple Tasks
Tasks that test dsca's ability to understand project structure and read/explain code.

| ID | Project | Task | Expected Behavior |
|----|---------|------|-------------------|
| L1-01 | python_basic | "列出这个项目的目录结构" | Detect Python project, list files |
| L1-02 | js_node | "解释 linked-list.js 的实现" | Read file, explain Node class and LinkedList |
| L1-03 | go_api | "这个Go项目实现了什么功能" | Detect Go module, explain REST API |
| L1-04 | java_basic | "分析 StringProcessor.java 中有哪些方法" | List methods with descriptions |
| L1-05 | shell_scripts | "deploy.sh 脚本的功能是什么" | Explain deployment flow |
| L1-06 | html_css | "分析这个前端项目的结构和功能" | Identify HTML/CSS/JS files, describe dashboard |

### L2 - Bug Fixing & Multi-file Editing
Tasks that require dsca to find and fix bugs, run tests.

| ID | Project | Task | Expected Behavior |
|----|---------|------|-------------------|
| L2-01 | python_basic | "运行测试并修复所有失败的测试" | Run pytest, fix 3 bugs (divide, power, undo) |
| L2-02 | js_node | "运行测试，修复 linked-list.js 中的bug" | Run node --test, fix remove/find bugs |
| L2-03 | js_node | "修复 event-emitter.js 中的所有bug" | Fix once listener removal, off comparison |
| L2-04 | go_api | "运行 go test 并修复失败的测试" | Fix Get 404, Update check, Add mutex, validation |
| L2-05 | java_basic | "编译并运行测试，修复所有bug" | Fix reverse loop, isPalindrome case, countWord case |
| L2-06 | shell_scripts | "修复 deploy.sh 中的bug" | Fix directory creation, source check, version validation |
| L2-07 | html_css | "修复HTML中的语义化和可访问性问题" | Add semantic tags, labels, proper buttons |
| L2-08 | python_web | "修复 app.py 中的bug" | Fix validation, PUT endpoint, delete check |

### L3 - Feature Development & Complex Tasks
Tasks that require implementing new functionality.

| ID | Project | Task | Expected Behavior |
|----|---------|------|-------------------|
| L3-01 | python_basic | "实现所有TODO标记的方法，并编写测试" | Implement 7 methods, add tests |
| L3-02 | js_node | "实现 linked-list.js 中所有TODO方法" | Implement insertAt, removeAt, reverse, has, toString |
| L3-03 | js_node | "实现 EventEmitter 的所有TODO方法" | Implement removeAllListeners, eventNames, prependListener |
| L3-04 | go_api | "实现 Filter, Search, Stats 方法和对应的HTTP端点" | Add 3 methods + 2 endpoints |
| L3-05 | java_basic | "实现所有TODO标记的方法" | Implement capitalize, truncate, countVowels, compress, isAnagram |
| L3-06 | shell_scripts | "为 deploy.sh 实现 rollback, cleanup, status 功能" | Add 3 functions with argument parsing |
| L3-07 | html_css | "添加响应式设计和暗黑模式" | Add media queries, CSS variables, toggle |
| L3-08 | python_web | "实现搜索、统计接口并编写完整的测试" | Add search/stats endpoints + pytest tests |

## Mode-Specific Tests

### Auto Mode Tests
Use L1 and L2 tasks - straightforward, single-objective tasks.

### Plan Mode Tests
Use L3 tasks - complex multi-step tasks that benefit from planning.
```
dsca --mode plan -w <project_dir> "task"
```

### Agent Mode Tests
Use combined L2+L3 tasks or cross-file tasks.
```
dsca --mode agent -w <project_dir> "task"
```

## Running Tests

```bash
# Python basic
cd test_project/python_basic && python -m pytest test_calculator.py -v

# JavaScript Node
cd test_project/js_node && node --test src/**/*.test.js

# Go API
cd test_project/go_api && go test -v ./...

# Java
cd test_project/java_basic && javac src/*.java && java -cp src StringProcessorTest

# Shell
cd test_project/shell_scripts && bash test_deploy.sh

# HTML/CSS - open in browser
open test_project/html_css/index.html
```

## DSCA Test Commands

```bash
DSCA="node /Users/baidu/Downloads/dsca/packages/cli/dist/index.js"

# L1 tests
$DSCA -w test_project/python_basic --confirm-all "列出这个项目的目录结构"
$DSCA -w test_project/go_api --confirm-all "这个Go项目实现了什么功能"

# L2 tests
$DSCA -w test_project/python_basic --confirm-all "运行测试并修复所有失败的测试"
$DSCA -w test_project/js_node --confirm-all "运行测试，修复 linked-list.js 中的bug"

# L3 tests
$DSCA --mode plan -w test_project/python_basic --confirm-all "实现所有TODO标记的方法，并编写测试"
$DSCA --mode agent -w test_project/go_api --confirm-all "实现 Filter, Search, Stats 方法和对应的HTTP端点"
```
