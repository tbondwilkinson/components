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
import {FlexibleConnectedPositionStrategyOrigin} from './flexible-connected-position-strategy';

/** Class to be added to the overlay bounding box. */
const boundingBoxClass = 'cdk-overlay-connected-position-bounding-box';

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

  /**
   * Parent element for the overlay panel used to constrain the overlay panel's size to fit
   * within the viewport.
   */
  private _boundingBox: HTMLElement | null;

  /** The anchor element against which the overlay will be positioned. */
  private _origin: FlexibleConnectedPositionStrategyOrigin;

  /** The original positioning of the overlay pane element. */
  private _paneOriginalPosition: string;

  /** Whether the strategy has been disposed of already. */
  private _isDisposed: boolean;

  /** Keeps track of the CSS classes that the position strategy has applied on the overlay panel. */
  private _appliedPanelClasses: string[] = [];

  /** Ordered list of preferred positions, from most to least desirable. */
  _preferredPositions: ConnectionPositionPair[] = [];

  constructor(
    origin: FlexibleConnectedPositionStrategyOrigin,
    private _document: Document,
    private _platform: Platform,
    private _overlayContainer: OverlayContainer,
  ) {
    this.setOrigin(origin);
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
  }

  /** Updates the position of the overlay element. */
  apply() {
    // We shouldn't do anything if the strategy was disposed or we're on the server.
    if (this._isDisposed || !this._platform.isBrowser) {
      return;
    }

    this._clearPanelClasses();
    this._resetOverlayElementStyles();
    this._resetBoundingBoxStyles();

    // Fixed position is necessary to position most anchored elements that reside within overlays.
    this._pane.style.position = 'fixed';

    const anchor =
      this._origin instanceof ElementRef
        ? (this._origin.nativeElement as Element)
        : (this._origin as Element);
    this._pane.anchorElement = anchor;

    this._applyPositionFallback();
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
  withOrigin(origin: FlexibleConnectedPositionStrategyOrigin): this {
    if (!(origin instanceof Element || origin instanceof ElementRef)) {
      throw new Error('AnchorPositioningStrategy only works with an Element or ElementRef');
    }
    this._origin = origin;

    return this;
  }

  private _applyPositionFallback() {}

  /** Clears the classes that the position strategy has applied from the overlay panel. */
  private _clearPanelClasses() {
    if (this._pane) {
      this._appliedPanelClasses.forEach(cssClass => {
        this._pane.classList.remove(cssClass);
      });
      this._appliedPanelClasses = [];
    }
  }

  /** Resets the styles for the bounding box so that a new positioning can be computed. */
  private _resetBoundingBoxStyles() {
    extendStyles(this._boundingBox!.style, {
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      height: '',
      width: '',
      alignItems: '',
      justifyContent: '',
    } as CSSStyleDeclaration);
  }

  /** Resets the styles for the overlay pane so that a new positioning can be computed. */
  private _resetOverlayElementStyles() {
    extendStyles(this._pane.style, {
      top: '',
      left: '',
      bottom: '',
      right: '',
      position: '',
      transform: '',
    } as CSSStyleDeclaration);
  }
}

/** Shallow-extends a stylesheet object with another stylesheet object. */
function extendStyles(
  destination: CSSStyleDeclaration,
  source: CSSStyleDeclaration,
): CSSStyleDeclaration {
  for (let key in source) {
    if (source.hasOwnProperty(key)) {
      destination[key] = source[key];
    }
  }

  return destination;
}
