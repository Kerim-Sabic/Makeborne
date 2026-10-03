// Client lists need only pipeline indicators. Fetch history only when opening a client.
export const CLIENT_LIST_SELECTION = "id,name,company,email,website,notes,created_at,updated_at,outreach_stage:outreach->>stage,outreach_follow_up:outreach->>nextFollowUp";
