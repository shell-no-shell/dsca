use crate::ast::*;
use crate::lexer::{Token, SpannedToken};

pub struct Parser {
    tokens: Vec<SpannedToken>,
    pos: usize,
}

impl Parser {
    pub fn new(tokens: Vec<SpannedToken>) -> Self {
        Parser { tokens, pos: 0 }
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.pos].token
    }

    fn span(&self) -> Span {
        self.tokens[self.pos].span.clone()
    }

    fn advance(&mut self) -> &SpannedToken {
        let tok = &self.tokens[self.pos];
        if self.pos < self.tokens.len() - 1 {
            self.pos += 1;
        }
        tok
    }

    fn expect(&mut self, expected: &Token) -> Result<Span, String> {
        if self.peek() == expected {
            let span = self.span();
            self.advance();
            Ok(span)
        } else {
            Err(format!("expected {:?}, got {:?} at {:?}", expected, self.peek(), self.span()))
        }
    }

    fn at(&self, token: &Token) -> bool {
        self.peek() == token
    }

    pub fn parse_program(&mut self) -> Result<Vec<Stmt>, String> {
        let mut stmts = Vec::new();
        while !self.at(&Token::Eof) {
            stmts.push(self.parse_stmt()?);
        }
        Ok(stmts)
    }

    fn parse_stmt(&mut self) -> Result<Stmt, String> {
        match self.peek().clone() {
            Token::Let => self.parse_let(),
            Token::Fn => self.parse_fn(),
            Token::Return => self.parse_return(),
            Token::While => self.parse_while(),
            Token::Print => self.parse_print(),
            _ => self.parse_expr_stmt(),
        }
    }

    fn parse_let(&mut self) -> Result<Stmt, String> {
        let span_start = self.span();
        self.advance(); // 'let'

        let name = match self.peek().clone() {
            Token::Ident(n) => { self.advance(); n }
            _ => return Err(format!("expected identifier after 'let'")),
        };

        let type_ann = if self.at(&Token::Colon) {
            self.advance();
            Some(self.parse_type()?)
        } else {
            None
        };

        self.expect(&Token::Assign)?;
        let value = self.parse_expr()?;
        self.expect(&Token::Semicolon)?;

        Ok(Stmt::Let { name, type_ann, value, span: span_start })
    }

    fn parse_fn(&mut self) -> Result<Stmt, String> {
        let span_start = self.span();
        self.advance(); // 'fn'

        let name = match self.peek().clone() {
            Token::Ident(n) => { self.advance(); n }
            _ => return Err("expected function name".to_string()),
        };

        self.expect(&Token::LParen)?;
        let mut params = Vec::new();
        while !self.at(&Token::RParen) {
            if !params.is_empty() {
                self.expect(&Token::Comma)?;
            }
            let param_name = match self.peek().clone() {
                Token::Ident(n) => { self.advance(); n }
                _ => return Err("expected parameter name".to_string()),
            };
            self.expect(&Token::Colon)?;
            let param_type = self.parse_type()?;
            params.push((param_name, param_type));
        }
        self.expect(&Token::RParen)?;

        let return_type = if self.at(&Token::Arrow) {
            self.advance();
            self.parse_type()?
        } else {
            Type::Void
        };

        let body = self.parse_block_expr()?;

        Ok(Stmt::Fn { name, params, return_type, body, span: span_start })
    }

    fn parse_return(&mut self) -> Result<Stmt, String> {
        let span = self.span();
        self.advance(); // 'return'

        let value = if self.at(&Token::Semicolon) {
            None
        } else {
            Some(self.parse_expr()?)
        };

        self.expect(&Token::Semicolon)?;
        Ok(Stmt::Return(value, span))
    }

    fn parse_while(&mut self) -> Result<Stmt, String> {
        let span = self.span();
        self.advance(); // 'while'

        let condition = self.parse_expr()?;
        let body = self.parse_block_expr()?;

        Ok(Stmt::While { condition, body, span })
    }

    fn parse_print(&mut self) -> Result<Stmt, String> {
        let span = self.span();
        self.advance(); // 'print'

        let value = self.parse_expr()?;
        self.expect(&Token::Semicolon)?;

        Ok(Stmt::Print(value, span))
    }

    fn parse_expr_stmt(&mut self) -> Result<Stmt, String> {
        let span = self.span();
        let expr = self.parse_expr()?;
        self.expect(&Token::Semicolon)?;
        Ok(Stmt::ExprStmt(expr, span))
    }

    pub fn parse_expr(&mut self) -> Result<Expr, String> {
        self.parse_assignment()
    }

    fn parse_assignment(&mut self) -> Result<Expr, String> {
        let expr = self.parse_or()?;

        if self.at(&Token::Assign) {
            let span = self.span();
            self.advance();
            let value = self.parse_assignment()?;

            match expr {
                Expr::Ident(name, _) => {
                    Ok(Expr::Assign {
                        name,
                        value: Box::new(value),
                        span,
                    })
                }
                _ => Err("invalid assignment target".to_string()),
            }
        } else {
            Ok(expr)
        }
    }

    fn parse_or(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_and()?;

        while self.at(&Token::Or) {
            let span = self.span();
            self.advance();
            let right = self.parse_and()?;
            left = Expr::BinaryOp {
                op: BinOp::Or,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }

        Ok(left)
    }

    // BUG: && has SAME precedence as || (should be higher)
    // Both parse_and and parse_or call each other at the same level
    fn parse_and(&mut self) -> Result<Expr, String> {
        // BUG: Should call parse_equality, but calls parse_or creating wrong precedence
        let mut left = self.parse_comparison()?;

        while self.at(&Token::And) {
            let span = self.span();
            self.advance();
            // BUG: This should call parse_comparison, not parse_or
            let right = self.parse_or()?;
            left = Expr::BinaryOp {
                op: BinOp::And,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }

        Ok(left)
    }

    fn parse_comparison(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_equality()?;

        while matches!(self.peek(), Token::Lt | Token::Gt | Token::Le | Token::Ge) {
            let span = self.span();
            let op = match self.peek() {
                Token::Lt => BinOp::Lt,
                Token::Gt => BinOp::Gt,
                Token::Le => BinOp::Le,
                Token::Ge => BinOp::Ge,
                _ => unreachable!(),
            };
            self.advance();
            let right = self.parse_equality()?;
            left = Expr::BinaryOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }

        Ok(left)
    }

    fn parse_equality(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_additive()?;

        while matches!(self.peek(), Token::Eq | Token::Ne) {
            let span = self.span();
            let op = match self.peek() {
                Token::Eq => BinOp::Eq,
                Token::Ne => BinOp::Ne,
                _ => unreachable!(),
            };
            self.advance();
            let right = self.parse_additive()?;
            left = Expr::BinaryOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }

        Ok(left)
    }

    fn parse_additive(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_multiplicative()?;

        while matches!(self.peek(), Token::Plus | Token::Minus) {
            let span = self.span();
            let op = match self.peek() {
                Token::Plus => BinOp::Add,
                Token::Minus => BinOp::Sub,
                _ => unreachable!(),
            };
            self.advance();
            let right = self.parse_multiplicative()?;
            left = Expr::BinaryOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }

        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_unary()?;

        while matches!(self.peek(), Token::Star | Token::Slash | Token::Percent) {
            let span = self.span();
            let op = match self.peek() {
                Token::Star => BinOp::Mul,
                Token::Slash => BinOp::Div,
                Token::Percent => BinOp::Mod,
                _ => unreachable!(),
            };
            self.advance();
            let right = self.parse_unary()?;
            left = Expr::BinaryOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }

        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<Expr, String> {
        match self.peek() {
            Token::Minus => {
                let span = self.span();
                self.advance();
                let operand = self.parse_unary()?;
                Ok(Expr::UnaryOp {
                    op: UnaryOp::Neg,
                    operand: Box::new(operand),
                    span,
                })
            }
            Token::Not => {
                let span = self.span();
                self.advance();
                let operand = self.parse_unary()?;
                Ok(Expr::UnaryOp {
                    op: UnaryOp::Not,
                    operand: Box::new(operand),
                    span,
                })
            }
            _ => self.parse_call(),
        }
    }

    fn parse_call(&mut self) -> Result<Expr, String> {
        let mut expr = self.parse_primary()?;

        loop {
            if self.at(&Token::LParen) {
                let span = self.span();
                self.advance();
                let mut args = Vec::new();
                while !self.at(&Token::RParen) {
                    if !args.is_empty() {
                        self.expect(&Token::Comma)?;
                    }
                    args.push(self.parse_expr()?);
                }
                self.expect(&Token::RParen)?;
                expr = Expr::Call {
                    callee: Box::new(expr),
                    args,
                    span,
                };
            } else if self.at(&Token::LBracket) {
                let span = self.span();
                self.advance();
                let index = self.parse_expr()?;
                self.expect(&Token::RBracket)?;
                expr = Expr::Index {
                    object: Box::new(expr),
                    index: Box::new(index),
                    span,
                };
            } else {
                break;
            }
        }

        Ok(expr)
    }

    fn parse_primary(&mut self) -> Result<Expr, String> {
        match self.peek().clone() {
            Token::Int(n) => {
                let span = self.span();
                self.advance();
                Ok(Expr::IntLit(n, span))
            }
            Token::Float(f) => {
                let span = self.span();
                self.advance();
                Ok(Expr::FloatLit(f, span))
            }
            Token::Bool(b) => {
                let span = self.span();
                self.advance();
                Ok(Expr::BoolLit(b, span))
            }
            Token::Str(s) => {
                let span = self.span();
                self.advance();
                Ok(Expr::StringLit(s, span))
            }
            Token::Ident(name) => {
                let span = self.span();
                self.advance();
                Ok(Expr::Ident(name, span))
            }
            Token::LParen => {
                self.advance();
                let expr = self.parse_expr()?;
                self.expect(&Token::RParen)?;
                Ok(expr)
            }
            Token::LBrace => self.parse_block_expr(),
            Token::LBracket => self.parse_array_literal(),
            Token::If => self.parse_if_expr(),
            _ => Err(format!("unexpected token {:?} at {:?}", self.peek(), self.span())),
        }
    }

    fn parse_block_expr(&mut self) -> Result<Expr, String> {
        let span = self.span();
        self.expect(&Token::LBrace)?;

        let mut stmts = Vec::new();
        let mut final_expr = None;

        while !self.at(&Token::RBrace) {
            if self.at(&Token::Eof) {
                return Err("unterminated block".to_string());
            }

            match self.peek() {
                Token::Let | Token::Fn | Token::Return | Token::While | Token::Print => {
                    stmts.push(self.parse_stmt()?);
                }
                _ => {
                    let expr = self.parse_expr()?;
                    if self.at(&Token::Semicolon) {
                        let s = self.span();
                        self.advance();
                        stmts.push(Stmt::ExprStmt(expr, s));
                    } else {
                        final_expr = Some(Box::new(expr));
                        break;
                    }
                }
            }
        }

        self.expect(&Token::RBrace)?;
        Ok(Expr::Block(stmts, final_expr, span))
    }

    fn parse_array_literal(&mut self) -> Result<Expr, String> {
        let span = self.span();
        self.expect(&Token::LBracket)?;

        let mut elements = Vec::new();
        while !self.at(&Token::RBracket) {
            if !elements.is_empty() {
                self.expect(&Token::Comma)?;
            }
            elements.push(self.parse_expr()?);
        }
        self.expect(&Token::RBracket)?;

        Ok(Expr::Array(elements, span))
    }

    fn parse_if_expr(&mut self) -> Result<Expr, String> {
        let span = self.span();
        self.advance(); // 'if'

        let condition = self.parse_expr()?;
        let then_branch = self.parse_block_expr()?;

        let else_branch = if self.at(&Token::Else) {
            self.advance();
            if self.at(&Token::If) {
                Some(Box::new(self.parse_if_expr()?))
            } else {
                Some(Box::new(self.parse_block_expr()?))
            }
        } else {
            None
        };

        Ok(Expr::If {
            condition: Box::new(condition),
            then_branch: Box::new(then_branch),
            else_branch,
            span,
        })
    }

    fn parse_type(&mut self) -> Result<Type, String> {
        match self.peek().clone() {
            Token::Ident(name) => {
                self.advance();
                match name.as_str() {
                    "int" => Ok(Type::Int),
                    "float" => Ok(Type::Float),
                    "bool" => Ok(Type::Bool),
                    "string" => Ok(Type::String),
                    "void" => Ok(Type::Void),
                    _ => Ok(Type::Generic(name)),
                }
            }
            Token::LBracket => {
                self.advance();
                let inner = self.parse_type()?;
                self.expect(&Token::RBracket)?;
                Ok(Type::Array(Box::new(inner)))
            }
            _ => Err(format!("expected type, got {:?}", self.peek())),
        }
    }
}
