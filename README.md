# Socrates App

A local-first strategy tree with two complementary workspaces:

- **Board** provides a spatial canvas for desktop and tablet work. On phones it is a touch-enabled preview that opens selected nodes in Focus.
- **Focus** provides a depth-independent editor with breadcrumbs, parent and sibling context, and an editable list of immediate children.

Sibling order is shared by Focus, Board order sheets, generated outlines, and exports. Drag handles and Move Up/Down controls provide pointer, keyboard, and screen-reader-friendly ordering.

## Run locally

The application uses browser ES modules, so serve the directory over HTTP:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Checks

```sh
npm test
npm run check
```

Version 3 data is stored under `strategyfractal-state-v3`. Existing v1 and v2 browser data is migrated automatically and retained as a recovery copy.
