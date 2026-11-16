# Bundled browser libraries

These files are loaded from the extension package into Chrome's isolated script world.

- `readability.js` is `package/Readability.js` from `@mozilla/readability` version 0.6.0. See `readability.LICENSE.md`.
- `turndown.js` is `package/dist/turndown.js` from `turndown` version 7.2.5. See `turndown.LICENSE`.

To update, extract the corresponding browser file and license from the versioned npm tarball. The source packages are maintained by [Mozilla](https://github.com/mozilla/readability) and [Mixmark](https://github.com/mixmark-io/turndown).
