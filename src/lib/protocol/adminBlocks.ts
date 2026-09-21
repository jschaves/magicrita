export type StaffBlocks = { users: string[]; comments: string[] };

const empty: StaffBlocks = { users: [], comments: [] };

export async function fetchStaffBlocks(): Promise<StaffBlocks> {
  try {
    const res = await fetch("/moderation/blocks");
    if (!res.ok) return empty;
    const data = (await res.json()) as StaffBlocks;
    return {
      users: Array.isArray(data.users) ? data.users : [],
      comments: Array.isArray(data.comments) ? data.comments : [],
    };
  } catch {
    return empty;
  }
}
