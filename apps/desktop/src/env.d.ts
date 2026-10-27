import type { DesktopBridge } from '../../../packages/core/contracts';

declare global {
  interface Window {
    codecast?: DesktopBridge;
  }
}
