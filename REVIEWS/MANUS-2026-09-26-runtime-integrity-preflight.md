
The persisted state now records both `sessionId` and `activeRunId`; agent-scoped keys prevent one saved agent from reading another agent’s task history. ForgeMind retains the legacy default key for safe migration.
