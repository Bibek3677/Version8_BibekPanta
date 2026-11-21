export const state = {
  tasks: [],    // the list as filtered and sorted by the server
  courses: [],
  filter: { status: 'all', course: '', q: '', sort: 'due' },
  editingId: null,
};


export const pendingDeletes = new Set();

export const visible = (tasks) => tasks.filter((t) => !pendingDeletes.has(t.id));
