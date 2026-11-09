# agent-team workspace — foundation only

This directory is the isolated workspace for the future built-in agent-team. It is deliberately separate from the Agent Bridge application and the user's other projects.

## Current safety boundary

The built-in Lab starts with read-only `list_files` and `read_file` tools, restricted to this directory. Absolute paths, `..` traversal, and symlinks escaping the workspace are rejected. There is no shell, write, or edit tool in this first step.

Future tools, context, prompts, configuration, and chat history should be added here and managed as a separate subsystem. Do not turn this starter scaffold into unrestricted access to the parent repository.
