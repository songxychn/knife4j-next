// Mock antd components for testing
const noop = (): null => null;

export const Button = noop;
export const Space = noop;
export const Typography = { Title: noop, Paragraph: noop };
export const Alert = noop;
export const Modal = { confirm: () => ({ destroy: () => undefined }) };
export const message = { error: () => Promise.resolve() };

export default { Button, Space, Typography, Alert, Modal, message };
