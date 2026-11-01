import styles from './gchat.module.css';
import { initialsOf, isGroup, kindOf, SAID, type Space } from './model';

/** "No spaces yet." — Chat lists a conversation only once it has a message in it. */
export function NoSpaces() {
  return (
    <div className={styles['none']} data-part="noSpaces">
      {SAID.noSpacesLead}
      <br />
      {SAID.noSpacesRest}
    </div>
  );
}

/** The spaces, a row for each: a circle with its initials (square-cornered for a space of people), its name, and what kind it is. */
export function SpaceRows({
  spaces,
  open,
  onOpen,
}: {
  spaces: Space[];
  /** the address of the space that is open */
  open: string | null;
  onOpen: (space: Space) => void;
}) {
  return (
    <>
      {spaces.map(space => {
        const here = open === space.name;
        return (
          <div
            key={space.name}
            className={`${styles['row']}${here ? ` ${styles['rowActive']}` : ''}`}
            data-part="spaceRow"
            role="button"
            tabIndex={0}
            {...(here ? { 'aria-current': true } : {})}
            onClick={() => onOpen(space)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(space);
              }
            }}
          >
            <div className={styles['avatarWrap']} data-part="spaceAvatarWrap">
              <div
                className={`${styles['avatar']}${isGroup(space) ? ` ${styles['avatarGroup']}` : ''}`}
                data-part="spaceAvatar"
              >
                {initialsOf(space.title)}
              </div>
            </div>
            <div className={styles['info']} data-part="spaceInfo">
              <div className={styles['spaceName']} data-part="spaceName">
                {space.title}
              </div>
              <div className={styles['preview']} data-part="spacePreview">
                {kindOf(space)}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
