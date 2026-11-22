import { asc, eq } from "drizzle-orm";

import type { RenderedComment } from "~/components/comment-thread";
import { comments, UserRole, users } from "~/db/schema";
import type { Database } from "~/lib/access.server";
import { renderComment } from "~/lib/comment-markdown.server";
import { type Markdown, markdown } from "~/lib/text";

interface ThreadComment {
  id: number;
  body: Markdown;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  author: {
    id: number;
    name: string;
    avatarUrl: string | null;
    isInstructor: boolean;
    isAdmin: boolean;
  };
  replies: ThreadComment[];
}

function selectLessonComments(database: Database, lessonId: number) {
  return database
    .select({
      id: comments.id,
      body: comments.body,
      parentId: comments.parentId,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      deletedAt: comments.deletedAt,
      authorId: users.id,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
      authorRole: users.role,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.lessonId, lessonId))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .all();
}

type CommentRow = ReturnType<typeof selectLessonComments>[number];

function toThreadComment(row: CommentRow, instructorId: number): ThreadComment {
  const isDeleted = row.deletedAt !== null;
  return {
    id: row.id,
    body: isDeleted ? markdown("") : row.body,
    createdAt: row.createdAt,
    editedAt: isDeleted ? null : row.editedAt,
    deleted: isDeleted,
    author: {
      id: row.authorId,
      name: row.authorName,
      avatarUrl: row.authorAvatarUrl,
      isInstructor: row.authorId === instructorId,
      isAdmin: row.authorRole === UserRole.Admin,
    },
    replies: [],
  };
}

/**
 * The lesson's discussion: questions in posting order, each with its replies.
 * A deleted question keeps its place, blanked, while it has replies; a
 * deleted reply is dropped.
 */
function getLessonThread(
  database: Database,
  lessonId: number,
  instructorId: number
) {
  const rows = selectLessonComments(database, lessonId);
  const questions = new Map<number, ThreadComment>();

  for (const row of rows) {
    if (row.parentId === null) {
      questions.set(row.id, toThreadComment(row, instructorId));
    }
  }

  for (const row of rows) {
    if (row.parentId === null || row.deletedAt !== null) continue;
    questions
      .get(row.parentId)
      ?.replies.push(toThreadComment(row, instructorId));
  }

  return [...questions.values()].filter(
    (question) => !question.deleted || question.replies.length > 0
  );
}

/**
 * Renders every comment body to sanitised HTML, preserving the reply nesting.
 * Comments are untrusted input, so this must be renderComment — never
 * renderMarkdown, which lets raw HTML through for trusted lesson content.
 */
async function renderThread(
  nodes: ThreadComment[]
): Promise<RenderedComment[]> {
  return Promise.all(
    nodes.map(async (node) => ({
      ...node,
      bodyHtml: node.deleted ? "" : await renderComment(node.body),
      replies: await renderThread(node.replies),
    }))
  );
}

/** The lesson's discussion, rendered for the page. */
export async function getRenderedThread(
  database: Database,
  lessonId: number,
  instructorId: number
) {
  return renderThread(getLessonThread(database, lessonId, instructorId));
}
