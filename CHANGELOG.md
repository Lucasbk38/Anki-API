# Change Log

All notable changes to the "ankiapi" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.1]

- Fixed crashes (`Cannot convert undefined or null to object`, `Cannot use 'in'
  operator ... in null`) when Anki answers with an empty response because it is
  busy (e.g. right after a sync): requests are now retried, and a clear error is
  shown if Anki still does not answer

## [0.1.0]

- Initial release
- Fixed field ordering when syncing to a note type (fields are now sorted by
  their actual position instead of relying on API response order)
- Fixed deck-name computation for nested folders on non-POSIX path separators
- Gracefully handle a configured template that no longer exists in Anki by
  asking which note type to use instead of failing the sync
- Removed unused/dead code paths
