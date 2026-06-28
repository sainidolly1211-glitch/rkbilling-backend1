import { body } from 'express-validator';

export const loginRules = [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
];

export const createUserRules = [
  body('email').isEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password min 8 chars'),
  body('full_name').notEmpty(),
  body('role').isIn(['admin', 'manager', 'staff', 'partner']),
];

export const productRules = [
  body('product_code').notEmpty().withMessage('Product code required'),
  body('name').notEmpty().withMessage('Name required'),
  body('selling_price').isFloat({ min: 0 }).withMessage('Selling price must be >= 0'),
  body('stock').optional().isInt({ min: 0 }),
];

export const invoiceRules = [
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('items.*.product_code').notEmpty(),
  body('items.*.selling_price').isFloat({ min: 0 }),
  body('items.*.quantity').isInt({ min: 1 }),
  body('payment_mode').isIn(['cash', 'upi', 'card', 'mixed']),
];

export const customerRules = [body('name').notEmpty().withMessage('Name required')];

export const stockRules = [
  body('product_id').notEmpty(),
  body('type').isIn(['stock_in', 'stock_out', 'adjustment', 'transfer', 'damage', 'loss', 'return', 'audit']),
  body('quantity').isNumeric(),
];
