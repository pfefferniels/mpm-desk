interface GenericInstructionViewProps {
    type: string;
    date: number;
}

export const GenericInstructionView = ({ type, date }: GenericInstructionViewProps) => {
    return (
        <div style={{ padding: "12px 16px", fontFamily: "system-ui, sans-serif" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#333", textTransform: "capitalize" }}>
                {type}
            </div>
            <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                tick {date}
            </div>
        </div>
    );
};
