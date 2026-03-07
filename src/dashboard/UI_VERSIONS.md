# Dashboard UI Versions

This package intentionally preserves **two dashboard variants**:

- **v1**: `src/dashboard/public/index.v1.html`
  - the earlier packaged single-page browser dashboard preserved from the prior zip
- **v2**: `src/dashboard/versions/ActuraDashboard.v2.jsx`
  - the newer tabbed control-plane dashboard based on the latest canvas design

The existing `src/dashboard/public/index.html` remains the currently wired packaged dashboard entrypoint.

This lets you keep both presentation styles in the repo without losing either iteration.


## Browser entrypoints

- `src/dashboard/public/ui-switcher.html` — choose between v1 and v2 in the browser
- `src/dashboard/public/index.v1.html` — preserved earlier packaged dashboard
- `src/dashboard/public/index.v2.html` — browser-runnable wrapper for the newer v2 React dashboard
