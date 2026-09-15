import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const root = join(mobile, '../..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const upload = read('apps/mobile/lib/mediaUpload.ts');
const stage = read('apps/mobile/components/screens/StageDetailScreen.tsx');
const plan = read('apps/mobile/components/renova/FloorPlanPanel.tsx');
const design = read('apps/mobile/components/renova/DesignPackageList.tsx');
const qc = read('apps/mobile/components/screens/QualityControlScreen.tsx');
const compare = read('apps/mobile/components/renova/PhotoCompare.tsx');
const swipe = read('apps/mobile/components/renova/PhotoSwipeCompare.tsx');
const acceptance = read('apps/mobile/components/screens/stage/StageDetailAcceptanceFold.tsx');
const mediaApi = read('backend/app/api/v1/media.py');
const mediaAcl = read('backend/app/services/project_media_acl.py');
const floorApi = read('backend/app/api/v1/floor_plans.py');
const designApi = read('backend/app/api/v1/design_packages.py');
const stageService = read('backend/app/services/stage_service.py');
const issueService = read('backend/app/services/issue_service.py');

must(
  upload.includes("'/api/v1/media/upload-url'")
    && upload.includes('project_id: projectId')
    && upload.includes("content_type: contentType")
    && upload.includes('uploadMediaBlob(\n  userId: string,\n  projectId: string,'),
  'media upload intent must carry explicit project id before storage PUT',
);
must(
  !upload.includes('getMediaUploadUrl(userId)'),
  'project media upload must not use legacy auth-only upload intent',
);
must(
  design.includes('uploadMediaBlob(\n        userId,\n        projectId,')
    && design.includes('downloadApiPath(')
    && !design.includes('Linking.openURL'),
  'design package upload/open must preserve project ACL',
);
must(
  plan.includes('uploadMediaBlob(userId, projectId, blob')
    && plan.includes('headers: authHeaders(userId)'),
  'floor plan and punch media must use project-scoped upload and authenticated reads',
);
must(
  stage.includes('uploadMediaBlob(\n            user.id,\n            activeProject.id,')
    && !stage.includes('api.getUploadUrl(user.id)')
    && stage.includes('headers: authHeaders(user.id)'),
  'stage photos must not use legacy upload-url and must authenticate reads',
);
must(
  qc.includes('headers: authHeaders(userId)')
    && compare.includes('authHeaders(user.id)')
    && swipe.includes('authHeaders(user.id)')
    && acceptance.includes('headers: authHeaders(userId)'),
  'all current project photo surfaces must send media read auth',
);

must(
  mediaApi.includes('class UploadUrlIn')
    && mediaApi.includes('await require_project(db, body.project_id, user, write=True)')
    && mediaApi.includes('project-media/{body.project_id}')
    && mediaApi.includes('assert_legacy_project_media_access'),
  'media API must mint project-bound keys and protect legacy project media',
);
must(
  mediaAcl.includes('len(project_ids) != 1')
    && mediaAcl.includes('raise HTTPException(404, "project_media_not_found")')
    && mediaAcl.includes('StagePhoto.storage_key == key')
    && mediaAcl.includes('DesignPackage.file_key')
    && mediaAcl.includes('FloorPlan.image_key')
    && mediaAcl.includes('ProjectIssue.photo_key'),
  'legacy project media must resolve through one persisted project reference or fail closed',
);
must(
  floorApi.includes('assert_project_media_key_for_project(')
    && designApi.includes('assert_project_media_key_for_project(')
    && stageService.includes('parsed.project_id != stage.project_id')
    && issueService.includes('parsed.project_id != project_id'),
  'project media attachment writers must reject foreign project keys',
);

console.log('projectMediaAcl.contract.test OK');
