export type OccupantType = "VESSEL" | "EVENT";

export type Berth = {
  id: string;
  name: string;
  lengthFt: number | null;
  capacity: number | null;
  allowsLengthBasedSharing: boolean;
  notes: string | null;
};

export type Reservation = {
  id: string;
  berthId: string;
  occupantName: string;
  occupantType: OccupantType;
  vesselLengthFt: number | null;
  startDate: string;
  endDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  notes: string | null;
  berth?: Berth;
};

export type DataQualityConflict = {
  berthId: string;
  berthName: string;
  type: "OVERLAP" | "LENGTH_MISMATCH";
  reservations: Reservation[];
  detail: string;
};
