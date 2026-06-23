use std::collections::HashMap;
use crate::ast::*;

#[derive(Debug)]
pub struct TypeChecker {
    scopes: Vec<HashMap<String, Type>>,
    functions: HashMap<String, (Vec<Type>, Type)>,
    errors: Vec<String>,
}

impl TypeChecker {
    pub fn new() -> Self {
        TypeChecker {
            scopes: vec![HashMap::new()],
            functions: HashMap::new(),
            errors: Vec::new(),
        }
    }

    pub fn check_program(&mut self, stmts: &[Stmt]) -> Result<(), Vec<String>> {
        for stmt in stmts {
            self.check_stmt(stmt);
        }

        if self.errors.is_empty() {
            Ok(())
        } else {
            Err(self.errors.clone())
        }
    }

    pub fn get_errors(&self) -> &[String] {
        &self.errors
    }

    fn push_scope(&mut self) {
        self.scopes.push(HashMap::new());
    }

    fn pop_scope(&mut self) {
        self.scopes.pop();
    }

    fn define(&mut self, name: &str, ty: Type) {
        if let Some(scope) = self.scopes.last_mut() {
            scope.insert(name.to_string(), ty);
        }
    }

    fn lookup(&self, name: &str) -> Option<Type> {
        for scope in self.scopes.iter().rev() {
            if let Some(ty) = scope.get(name) {
                return Some(ty.clone());
            }
        }
        None
    }

    fn check_stmt(&mut self, stmt: &Stmt) {
        match stmt {
            Stmt::Let { name, type_ann, value, .. } => {
                let value_type = self.check_expr(value);

                if let Some(ann) = type_ann {
                    if !self.types_compatible(ann, &value_type) {
                        self.errors.push(format!(
                            "type mismatch in let: expected {}, got {}",
                            ann, value_type
                        ));
                    }
                    self.define(name, ann.clone());
                } else {
                    self.define(name, value_type);
                }
            }

            Stmt::Fn { name, params, return_type, body, .. } => {
                let param_types: Vec<Type> = params.iter().map(|(_, t)| t.clone()).collect();
                self.functions.insert(
                    name.clone(),
                    (param_types.clone(), return_type.clone()),
                );
                self.define(
                    name,
                    Type::Function(param_types.clone(), Box::new(return_type.clone())),
                );

                self.push_scope();
                for (pname, ptype) in params {
                    self.define(pname, ptype.clone());
                }

                let body_type = self.check_expr(body);

                // BUG 1: Doesn't check return type against body type for non-void functions
                if *return_type != Type::Void {
                    // BUG: Should check body_type matches return_type
                    // Currently only checks if body is void when return type isn't
                    if body_type == Type::Void && *return_type != Type::Void {
                        // This check is incomplete - doesn't verify the actual types match
                    }
                }

                self.pop_scope();
            }

            Stmt::Return(expr, _) => {
                if let Some(e) = expr {
                    self.check_expr(e);
                }
            }

            Stmt::ExprStmt(expr, _) => {
                self.check_expr(expr);
            }

            Stmt::While { condition, body, .. } => {
                let cond_type = self.check_expr(condition);
                if cond_type != Type::Bool {
                    self.errors.push(format!(
                        "while condition must be bool, got {}", cond_type
                    ));
                }
                self.check_expr(body);
            }

            Stmt::Print(expr, _) => {
                self.check_expr(expr);
            }
        }
    }

    fn check_expr(&mut self, expr: &Expr) -> Type {
        match expr {
            Expr::IntLit(_, _) => Type::Int,
            Expr::FloatLit(_, _) => Type::Float,
            Expr::BoolLit(_, _) => Type::Bool,
            Expr::StringLit(_, _) => Type::String,

            Expr::Ident(name, _) => {
                match self.lookup(name) {
                    Some(ty) => ty,
                    None => {
                        self.errors.push(format!("undefined variable: {}", name));
                        Type::Unknown
                    }
                }
            }

            Expr::BinaryOp { op, left, right, .. } => {
                let left_type = self.check_expr(left);
                let right_type = self.check_expr(right);
                self.check_binary_op(op, &left_type, &right_type)
            }

            Expr::UnaryOp { op, operand, .. } => {
                let operand_type = self.check_expr(operand);
                match op {
                    UnaryOp::Neg => {
                        if operand_type != Type::Int && operand_type != Type::Float {
                            self.errors.push(format!(
                                "cannot negate type {}", operand_type
                            ));
                        }
                        operand_type
                    }
                    UnaryOp::Not => {
                        if operand_type != Type::Bool {
                            self.errors.push(format!(
                                "cannot apply ! to type {}", operand_type
                            ));
                        }
                        Type::Bool
                    }
                }
            }

            Expr::Call { callee, args, .. } => {
                let callee_type = self.check_expr(callee);

                match callee_type {
                    Type::Function(param_types, return_type) => {
                        if args.len() != param_types.len() {
                            self.errors.push(format!(
                                "expected {} arguments, got {}",
                                param_types.len(), args.len()
                            ));
                        }

                        for (i, (arg, param_type)) in args.iter().zip(param_types.iter()).enumerate() {
                            let arg_type = self.check_expr(arg);
                            // BUG 2: Doesn't handle generic type unification
                            if !self.types_compatible(param_type, &arg_type) {
                                self.errors.push(format!(
                                    "argument {} type mismatch: expected {}, got {}",
                                    i, param_type, arg_type
                                ));
                            }
                        }

                        *return_type
                    }
                    Type::Unknown => Type::Unknown,
                    _ => {
                        self.errors.push(format!(
                            "cannot call non-function type {}", callee_type
                        ));
                        Type::Unknown
                    }
                }
            }

            Expr::Index { object, index, .. } => {
                let object_type = self.check_expr(object);
                let index_type = self.check_expr(index);

                if index_type != Type::Int {
                    self.errors.push(format!(
                        "array index must be int, got {}", index_type
                    ));
                }

                match object_type {
                    Type::Array(inner) => *inner,
                    Type::String => Type::String,
                    _ => {
                        self.errors.push(format!(
                            "cannot index type {}", object_type
                        ));
                        Type::Unknown
                    }
                }
            }

            Expr::If { condition, then_branch, else_branch, .. } => {
                let cond_type = self.check_expr(condition);
                if cond_type != Type::Bool {
                    self.errors.push(format!(
                        "if condition must be bool, got {}", cond_type
                    ));
                }

                let then_type = self.check_expr(then_branch);

                if let Some(else_expr) = else_branch {
                    let else_type = self.check_expr(else_expr);
                    // BUG 3: Doesn't find common type for if/else branches
                    // int/float should unify to float, but currently requires exact match
                    if then_type != else_type && then_type != Type::Unknown && else_type != Type::Unknown {
                        self.errors.push(format!(
                            "if/else branch type mismatch: {} vs {}",
                            then_type, else_type
                        ));
                    }
                    then_type
                } else {
                    Type::Void
                }
            }

            Expr::Block(stmts, final_expr, _) => {
                self.push_scope();
                for stmt in stmts {
                    self.check_stmt(stmt);
                }
                let result = if let Some(expr) = final_expr {
                    self.check_expr(expr)
                } else {
                    Type::Void
                };
                self.pop_scope();
                result
            }

            Expr::Array(elements, _) => {
                if elements.is_empty() {
                    return Type::Array(Box::new(Type::Unknown));
                }

                let first_type = self.check_expr(&elements[0]);
                for (i, elem) in elements.iter().enumerate().skip(1) {
                    let elem_type = self.check_expr(elem);
                    if !self.types_compatible(&first_type, &elem_type) {
                        self.errors.push(format!(
                            "array element {} type mismatch: expected {}, got {}",
                            i, first_type, elem_type
                        ));
                    }
                }

                Type::Array(Box::new(first_type))
            }

            Expr::Assign { name, value, .. } => {
                let value_type = self.check_expr(value);
                match self.lookup(name) {
                    Some(existing) => {
                        if !self.types_compatible(&existing, &value_type) {
                            self.errors.push(format!(
                                "cannot assign {} to variable of type {}",
                                value_type, existing
                            ));
                        }
                    }
                    None => {
                        self.errors.push(format!("undefined variable: {}", name));
                    }
                }
                value_type
            }
        }
    }

    fn check_binary_op(&mut self, op: &BinOp, left: &Type, right: &Type) -> Type {
        match op {
            BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Mod => {
                // BUG 4: String concatenation with + is not handled
                if *left == Type::Int && *right == Type::Int {
                    Type::Int
                } else if (*left == Type::Float || *left == Type::Int)
                    && (*right == Type::Float || *right == Type::Int)
                {
                    Type::Float
                } else if *left == Type::Unknown || *right == Type::Unknown {
                    Type::Unknown
                } else {
                    self.errors.push(format!(
                        "cannot apply {} to {} and {}",
                        op, left, right
                    ));
                    Type::Unknown
                }
            }
            BinOp::Eq | BinOp::Ne => {
                if !self.types_compatible(left, right) && *left != Type::Unknown && *right != Type::Unknown {
                    self.errors.push(format!(
                        "cannot compare {} and {} with {}",
                        left, right, op
                    ));
                }
                Type::Bool
            }
            BinOp::Lt | BinOp::Gt | BinOp::Le | BinOp::Ge => {
                if !self.is_numeric(left) || !self.is_numeric(right) {
                    if *left != Type::Unknown && *right != Type::Unknown {
                        self.errors.push(format!(
                            "cannot compare {} and {} with {}",
                            left, right, op
                        ));
                    }
                }
                Type::Bool
            }
            BinOp::And | BinOp::Or => {
                if *left != Type::Bool && *left != Type::Unknown {
                    self.errors.push(format!(
                        "left operand of {} must be bool, got {}",
                        op, left
                    ));
                }
                if *right != Type::Bool && *right != Type::Unknown {
                    self.errors.push(format!(
                        "right operand of {} must be bool, got {}",
                        op, right
                    ));
                }
                Type::Bool
            }
        }
    }

    fn is_numeric(&self, ty: &Type) -> bool {
        matches!(ty, Type::Int | Type::Float)
    }

    // BUG 5: types_compatible doesn't handle Generic type unification
    fn types_compatible(&self, expected: &Type, actual: &Type) -> bool {
        if expected == actual {
            return true;
        }

        // Int is compatible with Float (implicit widening)
        if *expected == Type::Float && *actual == Type::Int {
            return true;
        }

        // Generic should unify with any concrete type - BUG: not implemented
        // Type::Generic should match any type and record the binding

        false
    }
}
