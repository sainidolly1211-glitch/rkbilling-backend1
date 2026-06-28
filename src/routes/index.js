import { Router } from 'express';
import multer from 'multer';

import { authenticate, requireRole, adminOnly } from '../middleware/auth.js';
import { validate, sanitizeBody } from '../middleware/validate.js';
import * as v from '../validators/index.js';

import * as auth from '../controllers/auth.controller.js';
import * as products from '../controllers/product.controller.js';
import * as invoices from '../controllers/invoice.controller.js';
import * as inventory from '../controllers/inventory.controller.js';
import * as customers from '../controllers/customer.controller.js';
import * as analytics from '../controllers/analytics.controller.js';
import * as reports from '../controllers/report.controller.js';
import * as misc from '../controllers/misc.controller.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

const router = Router();

router.get('/health', (_req, res) => res.json({ success: true, status: 'ok', time: new Date().toISOString() }));

// ---- Auth ------------------------------------------------------------------
router.post('/auth/login', sanitizeBody, v.loginRules, validate, auth.login);
router.post('/auth/refresh', auth.refresh);
router.get('/auth/me', authenticate, auth.me);
router.post('/auth/logout', authenticate, auth.logout);
router.post('/auth/users', authenticate, adminOnly, sanitizeBody, v.createUserRules, validate, auth.createUser);

// ---- Products --------------------------------------------------------------
router.get('/products/price-preview', authenticate, products.previewPrice);
router.get('/products/find/:code', authenticate, products.findByCode);
router.get('/products', authenticate, products.listProducts);
router.get('/products/:id', authenticate, products.getProduct);
router.post('/products', authenticate, requireRole('admin', 'manager'), sanitizeBody, v.productRules, validate, products.createProduct);
router.put('/products/:id', authenticate, requireRole('admin', 'manager'), sanitizeBody, products.updateProduct);
router.delete('/products/:id', authenticate, adminOnly, products.softDeleteProduct);
router.post('/products/bulk-import', authenticate, requireRole('admin', 'manager'), products.bulkImport);

// ---- Invoices / Billing ----------------------------------------------------
router.get('/invoices', authenticate, invoices.listInvoices);
router.get('/invoices/:id', authenticate, invoices.getInvoice);
router.post('/invoices', authenticate, sanitizeBody, v.invoiceRules, validate, invoices.createInvoice);
router.post('/invoices/:id/reprint', authenticate, invoices.reprintInvoice);
router.post('/invoices/:id/cancel', authenticate, requireRole('admin', 'manager'), invoices.cancelInvoice);

// ---- Inventory -------------------------------------------------------------
router.get('/inventory/overview', authenticate, inventory.overview);
router.get('/inventory/movements', authenticate, inventory.movements);
router.get('/inventory/dead-stock', authenticate, requireRole('admin', 'manager'), inventory.deadStock);
router.post('/inventory/adjust', authenticate, requireRole('admin', 'manager'), sanitizeBody, v.stockRules, validate, inventory.adjustStock);
router.post('/inventory/bulk-adjust', authenticate, requireRole('admin', 'manager'), inventory.bulkAdjust);

// ---- Customers -------------------------------------------------------------
router.get('/customers', authenticate, customers.listCustomers);
router.get('/customers/:id', authenticate, customers.getCustomer);
router.post('/customers', authenticate, sanitizeBody, v.customerRules, validate, customers.createCustomer);
router.put('/customers/:id', authenticate, sanitizeBody, customers.updateCustomer);
router.delete('/customers/:id', authenticate, adminOnly, customers.softDeleteCustomer);

// ---- Analytics -------------------------------------------------------------
router.get('/analytics/dashboard', authenticate, analytics.dashboard);
router.get('/analytics/sales-trend', authenticate, analytics.salesTrend);
router.get('/analytics/breakdown', authenticate, analytics.breakdown);

// ---- Reports ---------------------------------------------------------------
router.get('/reports/owner', authenticate, requireRole('admin', 'manager'), reports.ownerReport);
router.get('/reports/below-cost', authenticate, requireRole('admin', 'manager'), reports.belowCostSales);
router.get('/reports/export', authenticate, requireRole('admin', 'manager'), reports.exportData);

// ---- Audit -----------------------------------------------------------------
router.get('/audit', authenticate, requireRole('admin', 'manager'), misc.listAudit);

// ---- Notifications ---------------------------------------------------------
router.get('/notifications', authenticate, misc.listNotifications);
router.post('/notifications/:id/read', authenticate, misc.markNotificationRead);
router.post('/notifications/read-all', authenticate, misc.markAllRead);

// ---- Settings / Shop -------------------------------------------------------
router.get('/settings', authenticate, misc.getSettings);
router.put('/settings', authenticate, requireRole('admin', 'manager'), sanitizeBody, misc.updateSetting);
router.put('/shop', authenticate, adminOnly, sanitizeBody, misc.updateShop);

// ---- Categories & Brands ---------------------------------------------------
router.get('/categories', authenticate, misc.listCategories);
router.post('/categories', authenticate, requireRole('admin', 'manager'), misc.createCategory);
router.get('/brands', authenticate, misc.listBrands);
router.post('/brands', authenticate, requireRole('admin', 'manager'), misc.createBrand);

// ---- Users -----------------------------------------------------------------
router.get('/users', authenticate, requireRole('admin', 'manager'), misc.listUsers);
router.patch('/users/:id/active', authenticate, adminOnly, misc.setUserActive);

// ---- Uploads ---------------------------------------------------------------
router.post('/upload/images', authenticate, requireRole('admin', 'manager', 'partner'), upload.array('images', 6), misc.uploadProductImages);
router.post('/upload/parse', authenticate, requireRole('admin', 'manager'), upload.single('file'), misc.parseImportFile);

export default router;
