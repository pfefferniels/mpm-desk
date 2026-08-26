import '@testing-library/jest-dom'

// Lets `act()` flush React updates in this environment; without it React only warns
// and the assertions run against a half-committed tree.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
