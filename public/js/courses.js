// Courses: the course list, the course <select>s and adding/deleting courses.
import { $, el, showError, toast } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';

export async function loadCourses() {
  state.courses = await api('/api/courses');
  renderCourseSelects();
  renderCourses();
}

function renderCourseSelects() {
  const fill = (select, firstLabel, includeNone) => {
    const current = select.value;
    select.textContent = '';
    select.append(new Option(firstLabel, ''));
    if (includeNone) select.append(new Option('No course', 'none'));
    state.courses.forEach((c) => select.append(new Option(c.code, String(c.id))));
    select.value = [...select.options].some((o) => o.value === current) ? current : '';
  };
  fill($('task-course'), 'No course', false);
  fill($('edit-course'), 'No course', false);
  fill($('filter-course'), 'All courses', true);
}

function renderCourses() {
  const list = $('course-list');
  list.textContent = '';
  if (state.courses.length === 0) {
    list.append(el('li', 'empty-state', 'No courses yet. Add one below to group your tasks.'));
    return;
  }
  for (const c of state.courses) {
    const li = el('li', 'course-item');
    li.dataset.id = c.id;
    const left = el('div');
    left.append(el('strong', '', c.code), ' ', el('span', '', c.name));
    const count = el('span', 'count',
      c.task_count === 0 ? 'No tasks' : `${c.open_count} open of ${c.task_count}`);
    const right = el('div', 'task-actions');
    const del = el('button', 'delete', 'Delete');
    del.type = 'button';
    del.setAttribute('aria-label', `Delete course ${c.code}`);
    right.append(count, del);
    li.append(left, right);
    list.append(li);
  }
}

export function initCourses({ refresh }) {
  $('course-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/courses', {
        method: 'POST',
        body: { code: $('course-code').value, name: $('course-name').value },
      });
      $('course-code').value = '';
      $('course-name').value = '';
      showError($('course-error'), '');
      toast('Course added.');
      await refresh();
    } catch (err) {
      showError($('course-error'), err.message);
    }
  });

  $('course-list').addEventListener('click', async (event) => {
    if (!event.target.matches('.delete')) return;
    const id = Number(event.target.closest('.course-item').dataset.id);
    const course = state.courses.find((c) => c.id === id);
    if (!confirm(`Delete course ${course.code}?`)) return;
    try {
      await api(`/api/courses/${id}`, { method: 'DELETE' });
      if (state.filter.course === String(id)) state.filter.course = '';
      toast('Course deleted.');
      await refresh();
    } catch (err) {
      showError($('course-error'), err.message);
    }
  });
}
