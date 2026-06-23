mod ast;
mod lexer;
mod parser;
mod typechecker;

#[cfg(test)]
mod tests;

use std::io::{self, BufRead, Write};

fn run(input: &str) -> Result<(), String> {
    let mut lex = lexer::Lexer::new(input);
    let tokens = lex.tokenize()?;

    let mut parser = parser::Parser::new(tokens);
    let program = parser.parse_program()?;

    let mut checker = typechecker::TypeChecker::new();
    checker.check_program(&program).map_err(|errors| {
        errors.join("\n")
    })?;

    println!("OK: {} statements parsed and type-checked", program.len());
    Ok(())
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    println!("mini-lang REPL (type 'exit' to quit)");

    loop {
        print!("> ");
        stdout.flush().unwrap();

        let mut line = String::new();
        match stdin.lock().read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed == "exit" {
                    break;
                }
                if trimmed.is_empty() {
                    continue;
                }

                match run(trimmed) {
                    Ok(()) => {}
                    Err(e) => eprintln!("Error: {}", e),
                }
            }
            Err(e) => {
                eprintln!("Read error: {}", e);
                break;
            }
        }
    }
}
