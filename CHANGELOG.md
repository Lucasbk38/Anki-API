# Change Log

All notable changes to the "ankiapi" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.16]

- Initial release
- Fixed field ordering when syncing to a note type (fields are now sorted by
  their actual position instead of relying on API response order)
- Fixed deck-name computation for nested folders on non-POSIX path separators
- Gracefully handle a configured template that no longer exists in Anki by
  asking which note type to use instead of failing the sync
- Removed unused/dead code paths
