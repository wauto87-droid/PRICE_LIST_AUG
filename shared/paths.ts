// Fixed at build time; public hostname remains a runtime deployment setting.
export const APP_BASE_PATH = "/amt_price_list";
export const appPath = (path = "/") => `${APP_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
