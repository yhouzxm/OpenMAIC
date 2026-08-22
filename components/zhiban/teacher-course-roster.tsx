import type { CourseStudentRecord, CourseTeacherRecord } from '@/lib/zhiban/course-roster';

export function TeacherCourseTeachers({ teachers }: { teachers: CourseTeacherRecord[] }) {
  return (
    <RosterPanel title="课程教师" summary={`共 ${teachers.length} 条授课安排`}>
      <Table headings={['序号', '工号', '姓名', '机构', '教学班', '教学角色', '安排时间']}>
        {teachers.map((teacher, index) => (
          <tr key={`${teacher.id}-${teacher.offeringName}-${teacher.teachingRole}`} className="border-t">
            <Cell>{index + 1}</Cell><Cell>{teacher.employeeNo}</Cell><Cell>{teacher.name}</Cell>
            <Cell>{teacher.organizationName}</Cell><Cell>{teacher.offeringName}</Cell>
            <Cell>{roleLabel(teacher.teachingRole)}</Cell>
            <Cell>{new Date(teacher.assignedAt).toLocaleDateString('zh-CN')}</Cell>
          </tr>
        ))}
      </Table>
      {!teachers.length && <Empty>该课程尚未安排授课教师</Empty>}
    </RosterPanel>
  );
}

export function TeacherCourseStudents({ students }: { students: CourseStudentRecord[] }) {
  return (
    <RosterPanel title="选课学生" summary={`共 ${students.length} 名学生`}>
      <Table headings={['序号', '学号', '姓名', '机构', '行政班', '教学班', '选课状态', '选课时间']}>
        {students.map((student, index) => (
          <tr key={`${student.id}-${student.offeringName}`} className="border-t">
            <Cell>{index + 1}</Cell><Cell>{student.studentNo}</Cell><Cell>{student.name}</Cell>
            <Cell>{student.organizationName}</Cell><Cell>{student.className}</Cell>
            <Cell>{student.offeringName}</Cell><Cell>{statusLabel(student.status)}</Cell>
            <Cell>{new Date(student.enrolledAt).toLocaleDateString('zh-CN')}</Cell>
          </tr>
        ))}
      </Table>
      {!students.length && <Empty>该课程暂无选课学生</Empty>}
    </RosterPanel>
  );
}

function RosterPanel({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return <section className="border bg-white"><header className="flex items-center justify-between border-b px-5 py-4"><h2 className="text-lg font-semibold">{title}</h2><span className="text-sm text-slate-500">{summary}</span></header><div className="overflow-x-auto">{children}</div></section>;
}
function Table({ headings, children }: { headings: string[]; children: React.ReactNode }) {
  return <table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{headings.map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{children}</tbody></table>;
}
function Cell({ children }: { children: React.ReactNode }) { return <td className="whitespace-nowrap px-4 py-3">{children || '—'}</td>; }
function Empty({ children }: { children: React.ReactNode }) { return <div className="py-16 text-center text-sm text-slate-500">{children}</div>; }
function roleLabel(role: CourseTeacherRecord['teachingRole']) { return role === 'primary' ? '主讲教师' : role === 'assistant' ? '辅导教师' : '助教'; }
function statusLabel(status: string) { return status === 'enrolled' ? '已选课' : status === 'completed' ? '已完成' : status === 'dropped' ? '已退课' : status === 'pending' ? '待确认' : status; }
