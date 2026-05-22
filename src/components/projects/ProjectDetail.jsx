// PATCHES FOR src/components/projects/ProjectDetail.jsx

// 1. Replace existing NoticeServingModal render block with:

{noticeModal && (
  <NoticeServingModal
    project={project}
    ao={noticeModal.ao}
    aos={project.aos || []}
    defaultSections={noticeModal.defaultSections || []}
    generateDocument={generateDocument}
    onServe={({
      ao: servedAO,
      sections,
      includeCover,
      createDeadlineTask,
    }) =>
      handleServeNoticePack({
        ao: servedAO || noticeModal.ao,
        sections,
        includeCover,
        createDeadlineTask,
      })
    }
    onClose={() => setNoticeModal(null)}
  />
)}

// 2. Replace:
const handleServeNoticePack = useCallback(async ({ ao, sections, includeCover }) => {

// WITH:
const handleServeNoticePack = useCallback(async ({
  ao,
  sections,
  includeCover,
  createDeadlineTask = true,
}) => {

// 3. Wrap BOTH createProjectTask(...) blocks like this:

if (createDeadlineTask) {
  await createProjectTask({
    ...
  });
}

// Apply this to BOTH:
- notice_consent_deadline
- notice_section10_deadline
