use crate::ast::Span;

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    // Literals
    Int(i64),
    Float(f64),
    Str(String),
    Bool(bool),
    Ident(String),

    // Keywords
    Let,
    Fn,
    If,
    Else,
    While,
    Return,
    Print,

    // Operators
    Plus, Minus, Star, Slash, Percent,
    Eq, Ne, Lt, Gt, Le, Ge,
    And, Or, Not,
    Assign,

    // Delimiters
    LParen, RParen,
    LBrace, RBrace,
    LBracket, RBracket,
    Comma, Semicolon, Colon, Arrow,

    // Special
    Eof,
}

#[derive(Debug, Clone)]
pub struct SpannedToken {
    pub token: Token,
    pub span: Span,
}

pub struct Lexer {
    input: Vec<char>,
    pos: usize,
    line: usize,
    col: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Self {
        Lexer {
            input: input.chars().collect(),
            pos: 0,
            line: 1,
            col: 1,
        }
    }

    fn peek(&self) -> Option<char> {
        self.input.get(self.pos).copied()
    }

    fn advance(&mut self) -> Option<char> {
        let ch = self.input.get(self.pos).copied();
        if let Some(c) = ch {
            self.pos += 1;
            if c == '\n' {
                self.line += 1;
                self.col = 1;
            } else {
                self.col += 1;
            }
        }
        ch
    }

    fn peek_next(&self) -> Option<char> {
        self.input.get(self.pos + 1).copied()
    }

    fn skip_whitespace(&mut self) {
        while let Some(ch) = self.peek() {
            if ch.is_whitespace() {
                self.advance();
            } else if ch == '/' && self.peek_next() == Some('/') {
                while let Some(c) = self.peek() {
                    if c == '\n' { break; }
                    self.advance();
                }
            } else {
                break;
            }
        }
    }

    fn make_span(&self, start: usize, start_line: usize, start_col: usize) -> Span {
        Span::new(start, self.pos, start_line, start_col)
    }

    fn read_string(&mut self) -> Result<String, String> {
        let mut s = String::new();
        self.advance(); // skip opening quote

        loop {
            match self.advance() {
                None => return Err("unterminated string".to_string()),
                Some('"') => return Ok(s),
                Some('\\') => {
                    match self.advance() {
                        Some('n') => s.push('\n'),
                        Some('t') => s.push('\t'),
                        Some('\\') => s.push('\\'),
                        Some('"') => s.push('"'),
                        // BUG 1: Missing \r, \0 escape sequences
                        // BUG 2: Unknown escape sequences should error, but silently drops the backslash
                        Some(c) => s.push(c),
                        None => return Err("unterminated escape".to_string()),
                    }
                }
                Some(c) => s.push(c),
            }
        }
    }

    fn read_number(&mut self) -> Result<Token, String> {
        let mut num_str = String::new();
        let mut is_float = false;

        while let Some(ch) = self.peek() {
            if ch.is_ascii_digit() {
                num_str.push(ch);
                self.advance();
            } else if ch == '.' && !is_float {
                // BUG 3: Doesn't check if next char is a digit
                // "123.method()" would be parsed as float "123." which fails
                is_float = true;
                num_str.push(ch);
                self.advance();
            } else {
                break;
            }
        }

        if is_float {
            // BUG 4: "123." with no digits after dot will parse incorrectly
            match num_str.parse::<f64>() {
                Ok(f) => Ok(Token::Float(f)),
                Err(_) => Err(format!("invalid float: {}", num_str)),
            }
        } else {
            match num_str.parse::<i64>() {
                Ok(i) => Ok(Token::Int(i)),
                Err(_) => Err(format!("invalid integer: {}", num_str)),
            }
        }
    }

    fn read_ident(&mut self) -> Token {
        let mut name = String::new();

        while let Some(ch) = self.peek() {
            if ch.is_alphanumeric() || ch == '_' {
                name.push(ch);
                self.advance();
            } else {
                break;
            }
        }

        match name.as_str() {
            "let" => Token::Let,
            "fn" => Token::Fn,
            "if" => Token::If,
            "else" => Token::Else,
            "while" => Token::While,
            "return" => Token::Return,
            "print" => Token::Print,
            "true" => Token::Bool(true),
            "false" => Token::Bool(false),
            _ => Token::Ident(name),
        }
    }

    pub fn tokenize(&mut self) -> Result<Vec<SpannedToken>, String> {
        let mut tokens = Vec::new();

        loop {
            self.skip_whitespace();

            let start = self.pos;
            let start_line = self.line;
            let start_col = self.col;

            let ch = match self.peek() {
                None => {
                    tokens.push(SpannedToken {
                        token: Token::Eof,
                        span: self.make_span(start, start_line, start_col),
                    });
                    return Ok(tokens);
                }
                Some(c) => c,
            };

            let token = match ch {
                '"' => {
                    let s = self.read_string()?;
                    Token::Str(s)
                }
                '0'..='9' => self.read_number()?,
                'a'..='z' | 'A'..='Z' | '_' => self.read_ident(),

                '+' => { self.advance(); Token::Plus }
                '-' => {
                    self.advance();
                    if self.peek() == Some('>') {
                        self.advance();
                        Token::Arrow
                    } else {
                        Token::Minus
                    }
                }
                '*' => { self.advance(); Token::Star }
                '/' => { self.advance(); Token::Slash }
                '%' => { self.advance(); Token::Percent }

                '=' => {
                    self.advance();
                    if self.peek() == Some('=') {
                        self.advance();
                        Token::Eq
                    } else {
                        Token::Assign
                    }
                }
                '!' => {
                    self.advance();
                    if self.peek() == Some('=') {
                        self.advance();
                        Token::Ne
                    } else {
                        Token::Not
                    }
                }
                '<' => {
                    self.advance();
                    if self.peek() == Some('=') {
                        self.advance();
                        Token::Le
                    } else {
                        Token::Lt
                    }
                }
                '>' => {
                    self.advance();
                    if self.peek() == Some('=') {
                        self.advance();
                        Token::Ge
                    } else {
                        Token::Gt
                    }
                }
                '&' => {
                    self.advance();
                    if self.peek() == Some('&') {
                        self.advance();
                        Token::And
                    } else {
                        return Err(format!("unexpected '&' at line {}:{}", start_line, start_col));
                    }
                }
                '|' => {
                    self.advance();
                    if self.peek() == Some('|') {
                        self.advance();
                        Token::Or
                    } else {
                        return Err(format!("unexpected '|' at line {}:{}", start_line, start_col));
                    }
                }

                '(' => { self.advance(); Token::LParen }
                ')' => { self.advance(); Token::RParen }
                '{' => { self.advance(); Token::LBrace }
                '}' => { self.advance(); Token::RBrace }
                '[' => { self.advance(); Token::LBracket }
                ']' => { self.advance(); Token::RBracket }
                ',' => { self.advance(); Token::Comma }
                ';' => { self.advance(); Token::Semicolon }
                ':' => { self.advance(); Token::Colon }

                _ => return Err(format!("unexpected character '{}' at line {}:{}", ch, start_line, start_col)),
            };

            tokens.push(SpannedToken {
                token,
                span: self.make_span(start, start_line, start_col),
            });
        }
    }
}
