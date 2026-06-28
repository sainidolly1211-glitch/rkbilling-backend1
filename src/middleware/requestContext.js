import { UAParser } from 'ua-parser-js';

/**
 * Attaches device / network context to the request for audit logging
 * (IP, browser, OS, device).
 */
export function requestContext(req, _res, next) {
  const ua = new UAParser(req.headers['user-agent'] || '');
  const browser = ua.getBrowser();
  const os = ua.getOS();
  const device = ua.getDevice();

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    req.ip;

  req.context = {
    ip,
    userAgent: req.headers['user-agent'] || '',
    browser: [browser.name, browser.version].filter(Boolean).join(' ') || 'Unknown',
    os: [os.name, os.version].filter(Boolean).join(' ') || 'Unknown',
    device: device.type || 'Desktop',
  };
  next();
}
