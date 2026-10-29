/// <reference types="node" />
import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverMock, writable: true });

// jsdom has the dialog element but does not implement native modal methods.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
}
