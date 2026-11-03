import '@testing-library/jest-dom'

// Lets `act()` flush React updates in this environment; without it React only warns
// and the assertions run against a half-committed tree.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom lays nothing out and has no `scrollTo`; the stack calls it to bring a linked word into
// view on arrival. Scrolling there means setting the position, which is all a test can observe.
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function scrollTo(this: Element, options?: ScrollToOptions | number) {
        if (typeof options === 'object' && options.left !== undefined) this.scrollLeft = options.left
    } as Element['scrollTo']
}
