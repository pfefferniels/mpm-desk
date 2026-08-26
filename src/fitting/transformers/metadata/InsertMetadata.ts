import { Author } from 'espressivo';
import { Comment } from 'espressivo';
import { RelatedResource } from 'espressivo';
import { Mpm, unwrap } from '../../instructions/index';
import { Alignment } from '../../alignment';
import { AbstractTransformer, type TransformationOptions } from '../Transformer';

export interface AuthorOptions {
  number: number;
  text: string;
}

export interface CommentOptions {
  text: string;
}

export interface RelatedResourceOptions {
  uri: string;
  type: string;
}

export interface InsertMetadataOptions extends TransformationOptions {
  authors?: AuthorOptions[];
  comments?: CommentOptions[];
  relatedResources?: RelatedResourceOptions[];
}

/**
 * Writes the document's `<metadata>`: who made this performance description, what they said
 * about it, and which files it relates to.
 *
 * The one transformer that touches nothing dated — it adds no instruction and reads no note, so
 * it can stand anywhere in a chain.
 */
export class InsertMetadata extends AbstractTransformer<InsertMetadataOptions> {
  name = 'InsertMetadata';
  requires = [];

  constructor(options?: InsertMetadataOptions) {
    super(options || {});
  }

  protected transform(_msm: Alignment, mpm: Mpm): void {
    const authors = (this.options.authors ?? []).map((author) =>
      unwrap(Author.fromName(author.text, author.number, null), 'author'),
    );
    const comments = (this.options.comments ?? []).map((comment) =>
      unwrap(Comment.fromText(comment.text, null), 'comment'),
    );
    const resources = (this.options.relatedResources ?? []).map((resource) =>
      unwrap(RelatedResource.fromUri(resource.uri, resource.type), 'related resource'),
    );

    if (authors.length === 0 && comments.length === 0 && resources.length === 0) return;

    // `addMetadata` appends to a `<metadata>` that is already there, so a chain run twice
    // over the same document would list every author and comment twice. What the options
    // say is the whole of the metadata, not an addition to it.
    mpm.removeMetadata();

    // One author and one comment per call is all `addMetadata` takes; the resources ride
    // along with the first, which is the call that builds the element.
    const calls = Math.max(authors.length, comments.length, 1);
    for (let index = 0; index < calls; ++index) {
      mpm.addMetadata(
        authors.at(index) ?? null,
        comments.at(index) ?? null,
        index === 0 ? resources : null,
      );
    }

    this.moveMetadataFirst(mpm);
  }

  /**
   * Put `<metadata>` in front of the performances, where MPM's content model wants it:
   * `<mpm>` is `metadata? performance+`, a sequence.
   *
   * `Mpm.addMetadata` appends to the root, and appending after a `<performance>` is out of
   * order — faithfully so, since Java meico does the same (`Mpm.java:280`). Reading is
   * unaffected either way, so nothing catches it but a schema.
   */
  private moveMetadataFirst(mpm: Mpm) {
    const element = mpm.getMetadata()?.getXml();
    const root = mpm.getRootElement();
    if (!element || !root || root.indexOf(element) === 0) return;
    root.removeChild(element);
    root.insertChild(element, 0);
  }
}
