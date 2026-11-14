import * as React from 'react';
import {
  LiquidGlassOptions,
  LiquidGlassController,
  OPTICAL_DEFAULTS,
  OPTICAL_LIMITS,
  scheduleStageRedraw
} from './index';

export interface LiquidGlassProps
  extends LiquidGlassOptions,
    React.HTMLAttributes<HTMLElement>,
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    React.ButtonHTMLAttributes<HTMLButtonElement> {
  as?: React.ElementType;
  children?: React.ReactNode;
  [key: string]: any;
}

export declare function useLiquidGlass<T extends HTMLElement = HTMLDivElement>(
  options?: LiquidGlassOptions
): React.MutableRefObject<T | null>;

export declare const LiquidGlass: React.ForwardRefExoticComponent<
  LiquidGlassProps & React.RefAttributes<HTMLElement>
>;

export {
  LiquidGlassController,
  OPTICAL_DEFAULTS,
  OPTICAL_LIMITS,
  scheduleStageRedraw,
  setUseWebGL,
  isWebGLActive
};
export default LiquidGlass;
