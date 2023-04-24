/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {OverlayReference} from '../overlay-reference';
import {ElementRef} from '@angular/core';
import {PositionStrategy} from './position-strategy';
import {Platform} from '@angular/cdk/platform';
import {
  ConnectedOverlayPositionChange,
  ConnectionPositionPair,
  ScrollingVisibility,
  validateConnectionPositionPairs,
} from './connected-position';
import {OverlayContainer} from '../overlay-container';

/** Possible values that can be set as the anchor of a AnchorPositioningStrategy. */
export type AnchorPositioningStrategyAnchor = ElementRef | Element;

// TODO(tbondwilkinson): Remove once anchorElement is recognized.
declare global {
  interface HTMLElement {
    anchorElement: Element | undefined;
  }

  interface CSSStyleDeclaration {
    anchorName?: string;
    anchorDefault?: string;
    positionFallback?: string;
  }
}

export class AnchorPositioningStrategy implements PositionStrategy {
  /** The overlay to which this strategy is attached. */
  private _overlayRef: OverlayReference;

  /** The overlay pane element. */
  private _pane: HTMLElement;

  /** The original positioning of the overlay pane element. */
  private _paneOriginalPosition: string;

  /** Whether the strategy has been disposed of already. */
  private _isDisposed: boolean;

  /** The anchor element against which the overlay will be positioned. */
  private _anchor: AnchorPositioningStrategyAnchor;

  /** Ordered list of preferred positions, from most to least desirable. */
  _preferredPositions: ConnectionPositionPair[] = [];

  constructor(
    anchor: AnchorPositioningStrategyAnchor,
    private _document: Document,
    private _platform: Platform,
    private _overlayContainer: OverlayContainer,
  ) {
    this.withAnchor(anchor);
  }
  /** Attaches this position strategy to an overlay. */
  attach(overlayRef: OverlayReference): void {
    if (
      this._overlayRef &&
      overlayRef !== this._overlayRef &&
      (typeof ngDevMode === 'undefined' || ngDevMode)
    ) {
      throw Error('This position strategy is already attached to an overlay');
    }

    this._validatePositions();

    overlayRef.hostElement.classList.add(boundingBoxClass);

    this._overlayRef = overlayRef;
    this._boundingBox = overlayRef.hostElement;
    this._pane = overlayRef.overlayElement;
    this._isDisposed = false;
    this._isInitialRender = true;
    this._lastPosition = null;
    this._resizeSubscription.unsubscribe();
    this._resizeSubscription = this._viewportRuler.change().subscribe(() => {
      // When the window is resized, we want to trigger the next reposition as if it
      // was an initial render, in order for the strategy to pick a new optimal position,
      // otherwise position locking will cause it to stay at the old one.
      this._isInitialRender = true;
      this.apply();
    });
  }

  /** Attaches this position strategy to an overlay. */
  attach(overlayRef: OverlayReference) {
    if (
      this._overlayRef &&
      overlayRef !== this._overlayRef &&
      (typeof ngDevMode === 'undefined' || ngDevMode)
    ) {
      throw Error('This position strategy is already attached to an overlay');
    }

    this._overlayRef = overlayRef;
    this._pane = overlayRef.overlayElement;
    this._paneOriginalPosition = this._pane.style.position;
    this._isDisposed = false;
  }

  /** Updates the position of the overlay element. */
  apply() {
    // We shouldn't do anything if the strategy was disposed or we're on the server.
    if (this._isDisposed || !this._platform.isBrowser) {
      return;
    }
    // Fixed position is necessary to position most anchored elements that reside within overlays.
    this._pane.style.position = 'fixed';

    if (typeof this._anchor === 'string') {
      this._pane.style.anchorDefault = `--${this._anchor}`;
    } else {
      const anchor =
        this._anchor instanceof ElementRef ? (this._anchor.nativeElement as Element) : this._anchor;
      this._pane.anchorElement = anchor;
    }

    if (this._positionFallback) {
      this._pane.style.positionFallback = `--${this._positionFallback}`;
    }
  }

  /** Called when the overlay is detached. */
  detach() {
    this._pane.style.removeProperty('anchor-default');
    this._pane.style.removeProperty('position-fallback');
    this._pane.style.position = this._paneOriginalPosition;
    delete this._pane.anchorElement;
  }

  /** Cleans up any DOM modifications made by the position strategy, if necessary. */
  dispose() {
    if (this._isDisposed) {
      return;
    }

    this.detach();
    this._isDisposed = true;
  }

  /**
   * Sets the anchor, relative to which to position the overlay.
   * Using an element origin is useful for building components that need to be positioned
   * relatively to a trigger (e.g. dropdown menus or tooltips).
   * @param anchor Reference to the new origin.
   */
  withAnchor(anchor: AnchorPositioningStrategyAnchor): this {
    this._anchor = anchor;

    return this;
  }

  /** Sets the position fallback by name. */
  withPositionFallback(positionFallback: string): this {
    this._positionFallback = positionFallback;

    return this;
  }

  /** Validates that the current position match the expected values. */
  private _validatePositions(): void {
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      if (!this._preferredPositions.length) {
        throw Error('FlexibleConnectedPositionStrategy: At least one position is required.');
      }

    validateConnectionPositionPairs(this._preferredPositions.length);
  }
}
