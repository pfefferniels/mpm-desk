import { AppInfo } from "../../../mpm-ts/lib";


export const AppInfoDisplay = ({ appInfo }: { appInfo: AppInfo; }) => {
    return (
        <div>
            <div>
                Application Info:{' '}
                <a href={appInfo.url} style={{ fontWeight: 'bold' }}>{appInfo.name}</a>
                {' '}(Version {appInfo.version})
            </div>

            <div>
                {appInfo.children.map((transformation, j) => {
                    return (
                        <div key={`$transformation_${appInfo.name}_${j}`} style={{ marginLeft: '1rem', marginTop: '1.5rem' }}>
                            <b>{transformation.name}</b>
                            <div>
                                Parameters:
                                <pre>
                                    <code>
                                        {transformation.cdata}
                                    </code>
                                </pre>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
